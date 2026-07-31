// Image manipulation and inspection that needs no ML model.
const BLOCKED_HOSTS = /^(localhost$|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1)/i;

async function loadImage(image) {
  if (typeof image !== "string" || !image.length) {
    throw Object.assign(new Error("image is required"), { status: 400 });
  }
  let buf;
  if (image.startsWith("data:image/")) {
    buf = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  } else {
    let u;
    try {
      u = new URL(image);
    } catch {
      throw Object.assign(new Error("image must be an https URL or data URI"), { status: 400 });
    }
    if (!["http:", "https:"].includes(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) {
      throw Object.assign(new Error("image url not allowed"), { status: 400 });
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "blixtworks-tools/1.0" } });
    if (!res.ok) throw Object.assign(new Error(`image fetch failed: ${res.status}`), { status: 422 });
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (buf.length > 25_000_000) throw Object.assign(new Error("image too large"), { status: 413 });
  const { Jimp } = await import("jimp");
  try {
    return { jimp: await Jimp.read(buf), bytes: buf.length };
  } catch {
    throw Object.assign(new Error("could not decode image"), { status: 422 });
  }
}

export const tools = {
  image_info: {
    price: 0.01,
    description:
      'Image dimensions and properties without any ML. POST {"image": "https://..."} -> width, height, aspect ratio, format, file size, transparency.',
    output: { width: 0, height: 0, format: "string" },
    example: { image: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg" },
    run: async ({ image }) => {
      const { jimp, bytes } = await loadImage(image);
      const w = jimp.width;
      const h = jimp.height;
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      const g = gcd(w, h);
      return {
        width: w,
        height: h,
        megapixels: Number(((w * h) / 1e6).toFixed(2)),
        aspectRatio: `${w / g}:${h / g}`,
        aspectRatioDecimal: Number((w / h).toFixed(4)),
        bytes,
        humanSize: bytes > 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`,
        mimeType: jimp.mime ?? null,
        orientation: w > h ? "landscape" : w < h ? "portrait" : "square",
      };
    },
  },

  image_resize: {
    price: 0.02,
    description:
      'Resize or convert an image. POST {"image": "https://...", "width": 800, "height": null, "format": "jpeg"|"png", "quality": 80} -> data URI of the result.',
    output: { image: "data URI", width: 0, height: 0 },
    example: { image: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg", width: 320 },
    run: async ({ image, width, height, format = "jpeg", quality = 80 }) => {
      const { jimp } = await loadImage(image);
      const w = width ? Math.min(Math.max(Number(width), 1), 8000) : null;
      const h = height ? Math.min(Math.max(Number(height), 1), 8000) : null;
      if (!w && !h) throw Object.assign(new Error("provide width and/or height"), { status: 400 });
      const { Jimp } = await import("jimp");
      jimp.resize({ w: w ?? Jimp.AUTO, h: h ?? Jimp.AUTO });
      const mime = format === "png" ? "image/png" : format === "bmp" ? "image/bmp" : "image/jpeg";
      const buf = await jimp.getBuffer(mime, { quality: Math.min(Math.max(Number(quality) || 80, 1), 100) });
      return {
        image: `data:${mime};base64,${buf.toString("base64")}`,
        width: jimp.width,
        height: jimp.height,
        bytes: buf.length,
        format: mime,
      };
    },
  },

  image_palette: {
    price: 0.015,
    description:
      'Extract the dominant colour palette from an image. POST {"image": "https://...", "colors": 5} -> hex colours with share percentages.',
    output: { palette: [{ hex: "string", percentage: 0 }] },
    example: { image: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg", colors: 5 },
    run: async ({ image, colors = 5 }) => {
      const { jimp } = await loadImage(image);
      const n = Math.min(Math.max(Number(colors) || 5, 1), 16);
      const small = jimp.clone().resize({ w: 100, h: Math.max(1, Math.round((100 * jimp.height) / jimp.width)) });
      // Bucket into a coarse RGB grid, then rank buckets by pixel count.
      const buckets = new Map();
      let total = 0;
      for (let y = 0; y < small.height; y++) {
        for (let x = 0; x < small.width; x++) {
          const { r, g, b, a } = small.getPixelColor
            ? intToRgba(small.getPixelColor(x, y))
            : { r: 0, g: 0, b: 0, a: 255 };
          if (a < 128) continue;
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
          const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
          cur.r += r; cur.g += g; cur.b += b; cur.count++;
          buckets.set(key, cur);
          total++;
        }
      }
      const palette = [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, n)
        .map((c) => {
          const r = Math.round(c.r / c.count);
          const g = Math.round(c.g / c.count);
          const b = Math.round(c.b / c.count);
          return {
            hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
            rgb: { r, g, b },
            percentage: Number(((c.count / (total || 1)) * 100).toFixed(1)),
          };
        });
      return { palette, sampledPixels: total };
    },
  },

  image_crop: {
    price: 0.02,
    description:
      'Crop an image. POST {"image": "https://...", "x": 0, "y": 0, "width": 200, "height": 200} -> cropped image as a data URI.',
    output: { image: "data URI", width: 0, height: 0 },
    example: { image: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg", x: 0, y: 0, width: 200, height: 200 },
    run: async ({ image, x = 0, y = 0, width, height, format = "jpeg" }) => {
      const { jimp } = await loadImage(image);
      const px = Math.max(0, Math.floor(Number(x) || 0));
      const py = Math.max(0, Math.floor(Number(y) || 0));
      const w = Math.floor(Number(width) || jimp.width - px);
      const h = Math.floor(Number(height) || jimp.height - py);
      if (w < 1 || h < 1 || px + w > jimp.width || py + h > jimp.height) {
        throw Object.assign(new Error(`crop out of bounds (image is ${jimp.width}x${jimp.height})`), { status: 400 });
      }
      jimp.crop({ x: px, y: py, w, h });
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const buf = await jimp.getBuffer(mime, { quality: 85 });
      return { image: `data:${mime};base64,${buf.toString("base64")}`, width: w, height: h, bytes: buf.length };
    },
  },

  image_transform: {
    price: 0.02,
    description:
      'Rotate, flip or apply filters to an image. POST {"image": "...", "rotate": 90, "flip": "horizontal", "filter": "greyscale"|"sepia"|"invert"|"blur"} -> transformed image.',
    output: { image: "data URI" },
    example: { image: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg", filter: "greyscale" },
    run: async ({ image, rotate, flip, filter, format = "jpeg" }) => {
      const { jimp } = await loadImage(image);
      if (rotate != null) jimp.rotate(Number(rotate) || 0);
      if (flip === "horizontal") jimp.flip({ horizontal: true, vertical: false });
      if (flip === "vertical") jimp.flip({ horizontal: false, vertical: true });
      const filters = {
        greyscale: () => jimp.greyscale(),
        grayscale: () => jimp.greyscale(),
        sepia: () => jimp.sepia(),
        invert: () => jimp.invert(),
        blur: () => jimp.blur(5),
      };
      if (filter) {
        if (!filters[filter]) throw Object.assign(new Error(`unknown filter: ${filter}`), { status: 400 });
        filters[filter]();
      }
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const buf = await jimp.getBuffer(mime, { quality: 85 });
      return {
        image: `data:${mime};base64,${buf.toString("base64")}`,
        width: jimp.width,
        height: jimp.height,
        applied: { rotate: rotate ?? null, flip: flip ?? null, filter: filter ?? null },
      };
    },
  },

  image_placeholder: {
    price: 0.01,
    description:
      'Generate a solid or gradient placeholder image. POST {"width": 600, "height": 400, "color": "#2563eb", "text": "optional"} -> PNG data URI.',
    output: { image: "data URI" },
    example: { width: 400, height: 200, color: "#2563eb" },
    run: async ({ width = 400, height = 300, color = "#cccccc" }) => {
      const w = Math.min(Math.max(Number(width) || 400, 1), 2000);
      const h = Math.min(Math.max(Number(height) || 300, 1), 2000);
      const hex = String(color).replace(/^#/, "");
      if (!/^[0-9a-f]{6}$/i.test(hex)) throw Object.assign(new Error("color must be #rrggbb"), { status: 400 });
      const { Jimp } = await import("jimp");
      const img = new Jimp({ width: w, height: h, color: parseInt(hex + "ff", 16) });
      const buf = await img.getBuffer("image/png");
      return { image: `data:image/png;base64,${buf.toString("base64")}`, width: w, height: h, bytes: buf.length };
    },
  },
};

function intToRgba(int) {
  return {
    r: (int >> 24) & 255,
    g: (int >> 16) & 255,
    b: (int >> 8) & 255,
    a: int & 255,
  };
}

tools.qr = {
  price: 0.01,
  description:
    'QR code generation. POST {"text": "<content>", "format": "svg"|"png"} -> QR code as an SVG string or PNG data URI.',
  output: { svg: "string" },
  example: { text: "https://www.blixtworks.com", format: "svg" },
  run: async ({ text, format = "svg" }) => {
    if (typeof text !== "string" || !text.length || text.length > 2000) {
      throw Object.assign(new Error("text required (max 2000 chars)"), { status: 400 });
    }
    const QRCode = await import("qrcode");
    if (format === "png") return { png: await QRCode.toDataURL(text, { width: 512, margin: 2 }) };
    return { svg: await QRCode.toString(text, { type: "svg", margin: 2 }) };
  },
};

tools.exif = {
  price: 0.01,
  description:
    'EXIF metadata extraction. POST {"image": "<https url or data:image URI>"} -> camera, timestamps, GPS and other metadata.',
  output: { exif: {}, gps: null },
  example: { image: "https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg" },
  run: async ({ image }) => {
    if (typeof image !== "string") throw Object.assign(new Error("image is required"), { status: 400 });
    let buf;
    if (image.startsWith("data:image/")) {
      buf = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
    } else {
      const u = new URL(image);
      if (!["http:", "https:"].includes(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) {
        throw Object.assign(new Error("image url not allowed"), { status: 400 });
      }
      const res = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { "user-agent": "blixtworks-tools/1.0" } });
      if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
      buf = Buffer.from(await res.arrayBuffer());
    }
    const exifr = (await import("exifr")).default;
    const exif = await exifr.parse(buf, { gps: true }).catch(() => null);
    if (!exif) return { exif: {}, gps: null, note: "no EXIF data found" };
    const { latitude, longitude, ...rest } = exif;
    const clean = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v == null || typeof v === "function" || Buffer.isBuffer(v)) continue;
      clean[k] = v instanceof Date ? v.toISOString() : v;
    }
    return { exif: clean, gps: latitude != null && longitude != null ? { latitude, longitude } : null };
  },
};
