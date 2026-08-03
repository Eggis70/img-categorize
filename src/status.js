import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, formatUnits, formatEther, erc20Abi } from "viem";
import { base } from "viem/chains";
import { summary } from "./ledger.js";

const AGENT_ADDRESS = process.env.AGENT_ADDRESS;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

const [eth, usdc] = await Promise.all([
  client.getBalance({ address: AGENT_ADDRESS }),
  client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [AGENT_ADDRESS] }),
]);

const oppsFile = path.join(process.cwd(), "data", "opportunities.jsonl");
const opps = fs.existsSync(oppsFile) ? fs.readFileSync(oppsFile, "utf8").trim().split("\n").filter(Boolean).length : 0;

const tunnelLog = path.join(process.cwd(), "data", "tunnel.log");
let publicUrl = "(tunnel not running)";
if (fs.existsSync(tunnelLog)) {
  const m = fs.readFileSync(tunnelLog, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) publicUrl = m[0];
}

console.log(`wallet     ${AGENT_ADDRESS}`);
console.log(`USDC       $${formatUnits(usdc, 6)}`);
console.log(`ETH (gas)  ${formatEther(eth)}`);
console.log(`sales      ${JSON.stringify(summary())}`);
console.log(`bounty opportunities logged: ${opps}`);
console.log(`public URL ${publicUrl}`);

// Traffic history collected from the front door (its own counters reset on restart).
const trafficFile = path.join(process.cwd(), "data", "traffic.jsonl");
if (fs.existsSync(trafficFile)) {
  const lines = fs.readFileSync(trafficFile, "utf8").trim().split("\n").filter(Boolean);
  const peak = { requests: 0, freeTrialCalls: 0, paidCalls: 0, paywallHits: 0, mcpSessions: 0, discoveryHits: 0, uniqueCallers: 0 };
  const agents = {};
  for (const line of lines) {
    try {
      const s = JSON.parse(line);
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s[k] ?? 0);
      for (const [ua, n] of Object.entries(s.userAgents ?? {})) agents[ua] = Math.max(agents[ua] ?? 0, n);
    } catch { /* skip */ }
  }
  const top = Object.entries(agents).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log("");
  console.log(`traffic   ${peak.requests} requests · ${peak.freeTrialCalls} free · ${peak.paidCalls} paid · ${peak.paywallHits} left at paywall`);
  console.log(`          ${peak.discoveryHits} discovery-doc fetches · ${peak.mcpSessions} MCP sessions · ${peak.uniqueCallers} unique callers`);
  if (top.length) console.log(`clients   ${top.map(([a, n]) => `${a}(${n})`).join(", ")}`);
  console.log(`          (peaks since deploys; ${lines.length} samples)`);
}
