import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { createSIWxPayload, encodeSIWxHeader } from "@x402/extensions/sign-in-with-x";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const ENDPOINT = "https://www.x402scan.com/api/x402/registry/register";
const target = process.argv[2] ?? "https://img-categorize.onrender.com/categorize";

// 1. Get the SIWX challenge from the 402 response
const challengeRes = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: target }),
});
const challenge = await challengeRes.json();
const ext = challenge?.extensions?.["sign-in-with-x"];
if (!ext) {
  console.log("no SIWX challenge in response:", challengeRes.status, JSON.stringify(challenge).slice(0, 300));
  process.exit(1);
}

// 2. Sign it with the agent wallet
const payload = await createSIWxPayload(ext.info, account);
const header = encodeSIWxHeader(payload);

// 3. Retry with proof of wallet ownership
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", "SIGN-IN-WITH-X": header },
  body: JSON.stringify({ url: target }),
});
console.log("status:", res.status);
console.log((await res.text()).slice(0, 800));
