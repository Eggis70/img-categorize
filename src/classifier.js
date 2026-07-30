import { pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/clip-vit-base-patch32";

const DEFAULT_LABELS = [
  "photo of a person", "photo of an animal", "photo of food",
  "photo of a vehicle", "landscape or nature scene", "building or architecture",
  "screenshot of a user interface", "document or text", "chart or diagram",
  "product photo", "artwork or illustration", "logo or icon",
  "meme", "adult or explicit content", "medical image",
];

let classifierPromise = null;

export function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline("zero-shot-image-classification", MODEL);
  }
  return classifierPromise;
}

/**
 * Categorize an image against candidate labels.
 * @param {string} image - http(s) URL or data: URI
 * @param {string[]} [labels] - optional custom label set (2-50 entries)
 * @returns {Promise<{label: string, score: number}[]>}
 */
export async function categorize(image, labels) {
  const candidates = Array.isArray(labels) && labels.length >= 2
    ? labels.slice(0, 50).map(String)
    : DEFAULT_LABELS;
  const classifier = await getClassifier();
  const out = await classifier(image, candidates);
  return out.map(({ label, score }) => ({ label, score: Number(score.toFixed(4)) }));
}

export { DEFAULT_LABELS, MODEL };
