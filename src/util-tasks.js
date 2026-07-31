// Deterministic pay-per-call tools. No ML models — these run in-process on the
// front door and keep working even when the inference box is offline.
import { createRequire } from "node:module";
import dnsPromises from "node:dns/promises";

const require = createRequire(import.meta.url);

const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1)/i;

function assertPublicUrl(raw, protocols = ["https:", "http:"]) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Object.assign(new Error("invalid url"), { status: 400 });
  }
  if (!protocols.includes(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) {
    throw Object.assign(new Error("url not allowed"), { status: 400 });
  }
  return u;
}

async function fetchBuffer(url, maxBytes = 25_000_000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "user-agent": "blixtworks-tools/1.0 (+https://www.blixtworks.com)" },
  });
  if (!res.ok) throw Object.assign(new Error(`fetch failed: ${res.status}`), { status: 422 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw Object.assign(new Error("file too large"), { status: 413 });
  return buf;
}

function dataUriToBuffer(uri) {
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
}

export async function runMd({ url, html, mode = "article" }) {
  const { JSDOM } = await import("jsdom");
  const TurndownService = (await import("turndown")).default;
  let source = html;
  if (!source) {
    if (!url) throw Object.assign(new Error("provide url or html"), { status: 400 });
    assertPublicUrl(url);
    source = (await fetchBuffer(url, 10_000_000)).toString("utf8");
  }
  if (typeof source !== "string" || source.length > 10_000_000) {
    throw Object.assign(new Error("html too large"), { status: 413 });
  }
  const dom = new JSDOM(source, { url: url ?? "https://example.com/" });
  let title = dom.window.document.title || "";
  let byline = null;
  let contentHtml = dom.window.document.body?.innerHTML ?? source;
  if (mode !== "full") {
    const { Readability } = await import("@mozilla/readability");
    const article = new Readability(dom.window.document).parse();
    if (article?.content) {
      contentHtml = article.content;
      title = article.title || title;
      byline = article.byline ?? null;
    }
  }
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  return { markdown: turndown.turndown(contentHtml), title, byline };
}

export async function runPdf({ pdf }) {
  if (typeof pdf !== "string") throw Object.assign(new Error("provide pdf url or data URI"), { status: 400 });
  let buf;
  if (pdf.startsWith("data:application/pdf")) {
    buf = dataUriToBuffer(pdf);
  } else {
    assertPublicUrl(pdf);
    buf = await fetchBuffer(pdf, 25_000_000);
  }
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return {
      text: result.text?.slice(0, 2_000_000) ?? "",
      pages: result.total ?? result.pages?.length ?? null,
      info: { title: result.info?.Title ?? null, author: result.info?.Author ?? null },
    };
  } finally {
    await parser.destroy?.().catch?.(() => {});
  }
}

export async function runQr({ text, format = "svg" }) {
  if (typeof text !== "string" || !text.length || text.length > 2000) {
    throw Object.assign(new Error("text required (max 2000 chars)"), { status: 400 });
  }
  const QRCode = await import("qrcode");
  if (format === "png") {
    return { png: await QRCode.toDataURL(text, { width: 512, margin: 2 }) };
  }
  return { svg: await QRCode.toString(text, { type: "svg", margin: 2 }) };
}

export async function runExif({ image }) {
  if (typeof image !== "string") throw Object.assign(new Error("provide image url or data URI"), { status: 400 });
  let buf;
  if (image.startsWith("data:image/")) {
    buf = dataUriToBuffer(image);
  } else {
    assertPublicUrl(image);
    buf = await fetchBuffer(image, 25_000_000);
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
  return {
    exif: clean,
    gps: latitude != null && longitude != null ? { latitude, longitude } : null,
  };
}

const DNS_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME"];

export async function runDns({ domain, type = "all" }) {
  if (typeof domain !== "string" || !/^[a-z0-9.-]{1,253}$/i.test(domain) || BLOCKED_HOSTS.test(domain)) {
    throw Object.assign(new Error("invalid domain"), { status: 400 });
  }
  const wanted = type === "all" ? DNS_TYPES : [String(type).toUpperCase()];
  if (!wanted.every((t) => DNS_TYPES.includes(t))) {
    throw Object.assign(new Error(`type must be one of ${DNS_TYPES.join("/")} or all`), { status: 400 });
  }
  const records = {};
  await Promise.all(
    wanted.map(async (t) => {
      try {
        records[t] = await dnsPromises.resolve(domain, t);
      } catch {
        records[t] = [];
      }
    }),
  );
  return { domain, records };
}

export const UTIL_RUNNERS = { md: runMd, pdf: runPdf, qr: runQr, exif: runExif, dns: runDns };
