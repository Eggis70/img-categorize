import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, formatUnits, formatEther, erc20Abi } from "viem";
import { base } from "viem/chains";

const AGENT_ADDRESS = process.env.AGENT_ADDRESS;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const INTERVAL_MS = 15 * 60 * 1000;
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

// Keep our 402 Index listing pointed at the live tunnel URL — quick tunnels
// rotate on restart, which would otherwise orphan the listing.
async function keepListingFresh() {
  const url = currentTunnelUrl();
  if (!url) return { source: "402index", skipped: "no tunnel url" };
  const state = loadState();
  if (state.registeredUrl === url) return { source: "402index", ok: "listing current" };
  try {
    const res = await fetch("https://402index.io/api/v1/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${url}/categorize`,
        name: "img-categorize: zero-shot image categorization",
        protocol: "x402",
        priceUsd: 0.005,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, registeredUrl: url, serviceId: body?.service?.id }));
      return { source: "402index", registered: url, id: body?.service?.id };
    }
    return { source: "402index", error: body?.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { source: "402index", error: String(err?.message ?? err) };
  }
}

async function tick() {
  const [balances, claw, bazaar, listing] = await Promise.all([
    checkBalances().catch((e) => ({ error: String(e?.message ?? e) })),
    scanClawTasks(),
    scanBazaar(),
    keepListingFresh(),
  ]);
  const snapshot = { balances, claw, bazaar, listing };
  log("worker.jsonl", snapshot);
  console.log(new Date().toISOString(), JSON.stringify(snapshot));
}

console.log(`worker up: wallet=${AGENT_ADDRESS}, interval=${INTERVAL_MS / 60000}min`);
tick();
setInterval(tick, INTERVAL_MS);
