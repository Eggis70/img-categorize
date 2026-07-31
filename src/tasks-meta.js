// Single source of truth for the paid tool catalog (no model imports — safe
// for the proxy front door to load).
// kind: "vision" tasks run on the inference box (proxied); "util" tasks are
// deterministic and run in-process everywhere — they work even when the
// inference box is offline.
export const TASK_META = {
  md: {
    kind: "util",
    price: "$0.02",
    priceUsd: 0.02,
    description:
      "HTML to Markdown. POST {\"url\": \"<https url>\"} or {\"html\": \"<raw html>\"} (+ optional \"mode\": \"article\"|\"full\", default article) -> clean LLM-ready markdown with title/byline.",
    output: { markdown: "string", title: "string", byline: "string|null" },
  },
  pdf: {
    kind: "util",
    price: "$0.03",
    priceUsd: 0.03,
    description:
      "PDF text extraction. POST {\"pdf\": \"<https url or data:application/pdf base64 URI>\"} -> plain text + page count + metadata.",
    output: { text: "string", pages: "number", info: "object" },
  },
  qr: {
    kind: "util",
    price: "$0.01",
    priceUsd: 0.01,
    description:
      "QR code generation. POST {\"text\": \"<content>\", \"format\": \"svg\"|\"png\"} -> QR code as SVG string or PNG data URI.",
    output: { svg: "string (or png: data URI)" },
  },
  exif: {
    kind: "util",
    price: "$0.01",
    priceUsd: 0.01,
    description:
      "EXIF metadata extraction. POST {\"image\": \"<https url or data:image URI>\"} -> camera, timestamps, GPS and other metadata.",
    output: { exif: "object", gps: "object|null" },
  },
  dns: {
    kind: "util",
    price: "$0.01",
    priceUsd: 0.01,
    description:
      "DNS lookup. POST {\"domain\": \"example.com\", \"type\": \"A\"|\"AAAA\"|\"MX\"|\"TXT\"|\"NS\"|\"CNAME\"|\"all\"} -> resolved records.",
    output: { records: "object" },
  },
  categorize: {
    kind: "vision",
    price: "$0.02",
    priceUsd: 0.02,
    description:
      "Zero-shot image categorization (CLIP). POST {\"image\": \"<https url or data URI>\", \"labels\": [\"optional\", \"custom\"]} -> ranked labels with confidence scores.",
    output: { results: [{ label: "string", score: "0..1" }] },
  },
  caption: {
    kind: "vision",
    price: "$0.02",
    priceUsd: 0.02,
    description:
      "Image captioning. POST {\"image\": \"<https url or data URI>\"} -> one-sentence natural-language description.",
    output: { caption: "string" },
  },
  ocr: {
    kind: "vision",
    price: "$0.03",
    priceUsd: 0.03,
    description:
      "OCR (English). POST {\"image\": \"<https url or data URI>\"} -> extracted text with confidence score.",
    output: { text: "string", confidence: "0..100" },
  },
  embed: {
    kind: "vision",
    price: "$0.015",
    priceUsd: 0.015,
    description:
      "CLIP image embedding. POST {\"image\": \"<https url or data URI>\"} -> 512-dim vector for similarity search.",
    output: { embedding: "number[512]", dims: 512, model: "clip-vit-base-patch32" },
  },
};
