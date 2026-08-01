import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { createSIWxPayload, encodeSIWxHeader } from "@x402/extensions/sign-in-with-x";
import { TASK_META } from "./catalog.js";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const ENDPOINT = "https://www.x402scan.com/api/x402/registry/register";
const SERVICE_URL = process.env.SERVICE_URL ?? "https://www.blixtworks.com";

async function register(toolUrl) {
  const challengeRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: toolUrl }),
  });
  const challenge = await challengeRes.json().catch(() => ({}));
  const ext = challenge?.extensions?.["sign-in-with-x"];
  if (!ext) return { ok: challengeRes.ok, status: challengeRes.status, note: "no challenge" };

  const payload = await createSIWxPayload(ext.info, account);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "SIGN-IN-WITH-X": encodeSIWxHeader(payload) },
    body: JSON.stringify({ url: toolUrl }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.success, status: res.status, error: body?.error?.message ?? body?.error ?? null };
}

const names = process.argv[2] ? [process.argv[2]] : Object.keys(TASK_META);
let ok = 0;
const failed = [];

for (const name of names) {
  const url = `${SERVICE_URL}/${name}`;
  try {
    const r = await register(url);
    if (r.ok) {
      ok++;
      process.stdout.write(".");
    } else {
      failed.push(`${name}: ${r.error ?? r.status}`);
      process.stdout.write("x");
    }
  } catch (err) {
    failed.push(`${name}: ${String(err?.message ?? err).slice(0, 60)}`);
    process.stdout.write("x");
  }
  await new Promise((r) => setTimeout(r, 400)); // be polite
}

console.log(`\n${ok}/${names.length} registered on x402scan`);
if (failed.length) console.log("failures:\n  " + failed.slice(0, 10).join("\n  "));
