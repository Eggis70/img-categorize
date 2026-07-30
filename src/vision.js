import { pipeline } from "@huggingface/transformers";
import { categorize, DEFAULT_LABELS, getClassifier } from "./classifier.js";

let captionerPromise = null;
let embedderPromise = null;
let tesseractWorkerPromise = null;

function getCaptioner() {
  captionerPromise ??= pipeline("image-to-text", "Xenova/vit-gpt2-image-captioning", { dtype: "q8" });
  return captionerPromise;
}

function getEmbedder() {
  embedderPromise ??= pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32", { dtype: "q8" });
  return embedderPromise;
}

async function getTesseract() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  }
  return tesseractWorkerPromise;
}

async function dataUriToBuffer(image) {
  if (!image.startsWith("data:")) return image; // URLs pass through
  const base64 = image.slice(image.indexOf(",") + 1);
  return Buffer.from(base64, "base64");
}

export const TASKS = {
  categorize: {
    price: "$0.005",
    priceUsd: 0.005,
    description: "Zero-shot image categorization (CLIP): ranked labels with confidence scores. Optional custom labels (2-50).",
    run: async ({ image, labels }) => ({ results: await categorize(image, labels) }),
  },
  caption: {
    price: "$0.005",
    priceUsd: 0.005,
    description: "Image captioning: one-sentence natural-language description of the image.",
    run: async ({ image }) => {
      const captioner = await getCaptioner();
      const out = await captioner(image);
      return { caption: out?.[0]?.generated_text ?? "" };
    },
  },
  ocr: {
    price: "$0.01",
    priceUsd: 0.01,
    description: "OCR (English): extract printed text from an image, with confidence score.",
    run: async ({ image }) => {
      const worker = await getTesseract();
      const { data } = await worker.recognize(await dataUriToBuffer(image));
      return { text: data.text, confidence: data.confidence };
    },
  },
  embed: {
    price: "$0.003",
    priceUsd: 0.003,
    description: "CLIP image embedding: 512-dim vector for similarity search and clustering.",
    run: async ({ image }) => {
      const embedder = await getEmbedder();
      const out = await embedder(image);
      return { embedding: Array.from(out.data).map((v) => Number(v.toFixed(6))), dims: 512, model: "clip-vit-base-patch32" };
    },
  },
};

export async function runTask(task, body) {
  const t = TASKS[task];
  if (!t) throw Object.assign(new Error("unknown task"), { status: 404 });
  return t.run(body);
}

export function warmup() {
  return getClassifier(); // others load lazily on first request
}

export { DEFAULT_LABELS };
