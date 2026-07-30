// Single source of truth for the paid tool catalog (no model imports — safe
// for the proxy front door to load).
export const TASK_META = {
  categorize: {
    price: "$0.005",
    priceUsd: 0.005,
    description:
      "Zero-shot image categorization (CLIP). POST {\"image\": \"<https url or data URI>\", \"labels\": [\"optional\", \"custom\"]} -> ranked labels with confidence scores.",
    output: { results: [{ label: "string", score: "0..1" }] },
  },
  caption: {
    price: "$0.005",
    priceUsd: 0.005,
    description:
      "Image captioning. POST {\"image\": \"<https url or data URI>\"} -> one-sentence natural-language description.",
    output: { caption: "string" },
  },
  ocr: {
    price: "$0.01",
    priceUsd: 0.01,
    description:
      "OCR (English). POST {\"image\": \"<https url or data URI>\"} -> extracted text with confidence score.",
    output: { text: "string", confidence: "0..100" },
  },
  embed: {
    price: "$0.003",
    priceUsd: 0.003,
    description:
      "CLIP image embedding. POST {\"image\": \"<https url or data URI>\"} -> 512-dim vector for similarity search.",
    output: { embedding: "number[512]", dims: 512, model: "clip-vit-base-patch32" },
  },
};
