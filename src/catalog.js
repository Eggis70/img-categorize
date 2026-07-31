// The complete tool catalogue: ML-backed vision tools (proxied to the inference
// box) plus deterministic utility tools (run in-process anywhere).
import { VISION_META } from "./tasks-meta.js";
import { UTIL_META, UTIL_RUNNERS, UTIL_TOOLS } from "./tools/index.js";

const VISION_EXAMPLES = {
  categorize: { image: "https://example.com/photo.jpg", labels: ["cat", "dog", "car"] },
  caption: { image: "https://example.com/photo.jpg" },
  ocr: { image: "https://example.com/scan.jpg" },
  embed: { image: "https://example.com/photo.jpg" },
};

export const TASK_META = {
  ...Object.fromEntries(
    Object.entries(VISION_META).map(([name, meta]) => [
      name,
      { ...meta, group: "vision", example: VISION_EXAMPLES[name] },
    ]),
  ),
  ...UTIL_META,
};

export { UTIL_RUNNERS, UTIL_TOOLS };

export const GROUPS = {
  vision: "Vision (AI models)",
  media: "Images",
  text: "Text",
  data: "Data formats",
  web: "Web & network",
  convert: "Convert & validate",
  chain: "Blockchain (read-only)",
};

export function toolsByGroup() {
  const out = {};
  for (const [name, meta] of Object.entries(TASK_META)) {
    (out[meta.group] ??= []).push({ name, ...meta });
  }
  return out;
}
