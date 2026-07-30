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
