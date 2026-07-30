import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const LEDGER = path.join(DATA_DIR, "ledger.jsonl");

fs.mkdirSync(DATA_DIR, { recursive: true });

export function record(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(LEDGER, line + "\n");
}

export function summary() {
  if (!fs.existsSync(LEDGER)) return { calls: 0, grossUsd: 0 };
  const lines = fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean);
  let grossUsd = 0;
  let calls = 0;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.type === "sale") { calls += 1; grossUsd += e.priceUsd || 0; }
    } catch { /* skip malformed line */ }
  }
  return { calls, grossUsd: Number(grossUsd.toFixed(4)) };
}
