import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, formatUnits, formatEther, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const AGENT_ADDRESS = process.env.AGENT_ADDRESS;
const SERVICE_URL = process.env.SERVICE_URL; // permanent front door (Render)
const INFER_TOKEN = process.env.INFER_TOKEN;
const signer = process.env.AGENT_PRIVATE_KEY ? privateKeyToAccount(process.env.AGENT_PRIVATE_KEY) : null;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const INTERVAL_MS = 10 * 60 * 1000;
const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

// Bounties we can plausibly complete autonomously (text/code/data work)
const DOABLE = /\b(writ|summar|research|categori[sz]|classif|label|caption|translat|scrape|extract|analy[sz]|code|script|debug|review|data|list|find|search|describe|json|csv|markdown)\b/i;
const BLOCKERS = /\b(twitter|x\.com account|instagram|tiktok|video|voice|call|in.person|physical|human only|kyc|selfie)\b/i;

function log(file, obj) {
  fs.appendFileSync(path.join(DATA_DIR, file), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
}

async function checkBalances() {
  const [eth, usdc] = await Promise.all([
    client.getBalance({ address: AGENT_ADDRESS }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [AGENT_ADDRESS] }),
  ]);
  return { ethBase: formatEther(eth), usdc: formatUnits(usdc, 6) };
}

async function scanClawTasks() {
  try {
    const res = await fetch("https://clawtasks.com/api/bounties?status=open", { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { source: "clawtasks", error: `HTTP ${res.status}` };
    const data = await res.json();
    const bounties = Array.isArray(data) ? data : data.bounties || data.items || [];
    const scored = bounties.map((b) => {
      const text = `${b.title ?? ""} ${b.description ?? ""}`;
      return {
        id: b.id,
        title: b.title,
        amountUsdc: b.amount,
        doable: DOABLE.test(text) && !BLOCKERS.test(text),
        url: `https://clawtasks.com/bounties/${b.id}`,
      };
    });
    const doable = scored.filter((b) => b.doable);
    for (const opp of doable) log("opportunities.jsonl", { source: "clawtasks", ...opp });
    return { source: "clawtasks", open: scored.length, doable: doable.length };
  } catch (err) {
    return { source: "clawtasks", error: String(err?.message ?? err) };
  }
}

async function scanBazaar() {
  // Market intel: what x402 services exist and at what prices (informs our pricing/products)
  try {
    const res = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=100", {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { source: "bazaar", error: `HTTP ${res.status}` };
    const { items = [] } = await res.json();
    const competitors = items.filter((i) =>
      /image|vision|photo|classif|categori/i.test(i.description ?? "")
    );
    return { source: "bazaar", listed: items.length, imageServices: competitors.length };
  } catch (err) {
    return { source: "bazaar", error: String(err?.message ?? err) };
  }
}

const STATE_FILE = path.join(DATA_DIR, "state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}

function currentTunnelUrl() {
  try {
    const log = fs.readFileSync(path.join(DATA_DIR, "tunnel.log"), "utf8");
    const matches = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    return matches ? matches[matches.length - 1] : null;
  } catch { return null; }
}

// Announce the current tunnel URL to the Render front door, signed with the
// agent wallet key so nobody else can hijack the inference upstream.
async function heartbeatUpstream() {
  if (!SERVICE_URL || !INFER_TOKEN || !signer) return { source: "heartbeat", skipped: "not configured" };
  const url = currentTunnelUrl();
  if (!url) return { source: "heartbeat", skipped: "no tunnel url" };
  const ts = Date.now();
  const payload = { url, token: INFER_TOKEN, ts };
  try {
    const signature = await signer.signMessage({ message: JSON.stringify(payload) });
    const res = await fetch(`${SERVICE_URL}/internal/upstream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, signature }),
      signal: AbortSignal.timeout(60000),
    });
    return { source: "heartbeat", status: res.status };
  } catch (err) {
    return { source: "heartbeat", error: String(err?.message ?? err) };
  }
}

const LISTINGS = [
  { path: "categorize", name: "Blixtworks: zero-shot image categorization", priceUsd: 0.02 },
  { path: "caption", name: "Blixtworks: image captioning", priceUsd: 0.02 },
  { path: "ocr", name: "Blixtworks: OCR text extraction", priceUsd: 0.03 },
  { path: "embed", name: "Blixtworks: CLIP image embeddings", priceUsd: 0.015 },
  { path: "md", name: "Blixtworks: webpage to LLM-ready Markdown", priceUsd: 0.02 },
  { path: "pdf", name: "Blixtworks: PDF text extraction", priceUsd: 0.03 },
  { path: "qr", name: "Blixtworks: QR code generation", priceUsd: 0.01 },
  { path: "exif", name: "Blixtworks: EXIF metadata extraction", priceUsd: 0.01 },
  { path: "dns", name: "Blixtworks: DNS records lookup", priceUsd: 0.01 },
];

// Keep our 402 Index listings pointed at the permanent front-door URL.
async function keepListingFresh() {
  const url = SERVICE_URL || currentTunnelUrl();
  if (!url) return { source: "402index", skipped: "no url" };
  const state = loadState();
  const done = state.registered402 ?? {};
  const results = [];
  for (const l of LISTINGS) {
    if (done[l.path] === url) continue;
    try {
      const res = await fetch("https://402index.io/api/v1/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${url}/${l.path}`, name: l.name, protocol: "x402", priceUsd: l.priceUsd }),
        signal: AbortSignal.timeout(25000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        done[l.path] = url;
        results.push(`${l.path}:ok`);
      } else {
        results.push(`${l.path}:${body?.error ?? res.status}`);
      }
    } catch (err) {
      results.push(`${l.path}:${String(err?.message ?? err).slice(0, 40)}`);
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, registered402: done }));
  return { source: "402index", results: results.length ? results : ["all current"] };
}

async function tick() {
  const [balances, claw, bazaar, listing, heartbeat] = await Promise.all([
    checkBalances().catch((e) => ({ error: String(e?.message ?? e) })),
    scanClawTasks(),
    scanBazaar(),
    keepListingFresh(),
    heartbeatUpstream(),
  ]);
  const snapshot = { balances, claw, bazaar, listing, heartbeat };
  log("worker.jsonl", snapshot);
  console.log(new Date().toISOString(), JSON.stringify(snapshot));
}

console.log(`worker up: wallet=${AGENT_ADDRESS}, interval=${INTERVAL_MS / 60000}min`);
tick();
setInterval(tick, INTERVAL_MS);
// Faster heartbeat so the front door recovers quickly after its own redeploys.
setInterval(() => heartbeatUpstream().catch(() => {}), 4 * 60 * 1000);
