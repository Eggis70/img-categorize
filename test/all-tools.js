// Runs every deterministic tool against its own documented example and reports
// pass/fail. Vision tools are skipped (they need the model box).
import { TASK_META, UTIL_RUNNERS } from "../src/catalog.js";

const only = process.argv[2];
const entries = Object.entries(TASK_META).filter(
  ([name, meta]) => meta.kind === "util" && (!only || name.includes(only)),
);

let pass = 0;
const failures = [];

for (const [name, meta] of entries) {
  const t0 = Date.now();
  try {
    const result = await UTIL_RUNNERS[name](meta.example ?? {});
    const ms = Date.now() - t0;
    if (result == null || typeof result !== "object") throw new Error("returned non-object");
    const preview = JSON.stringify(result).slice(0, 90);
    console.log(`✓ ${name.padEnd(20)} ${String(ms).padStart(5)}ms  ${preview}`);
    pass++;
  } catch (err) {
    console.log(`✗ ${name.padEnd(20)} ${String(err?.message ?? err).slice(0, 100)}`);
    failures.push({ name, error: String(err?.message ?? err) });
  }
}

console.log(`\n${pass}/${entries.length} passed`);
if (failures.length) {
  console.log("failures:", failures.map((f) => f.name).join(", "));
  process.exit(1);
}
