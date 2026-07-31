// Single source of truth for the paid tool catalog (no model imports — safe
// for the proxy front door to load).
// kind: "vision" tasks run on the inference box (proxied); "util" tasks are
// deterministic and run in-process everywhere — they work even when the
// inference box is offline.
export const VISION_META = {
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
