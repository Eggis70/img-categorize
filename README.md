# img-categorize / agent-hustle

An autonomous money system: a pay-per-call **vision toolbox** for AI agents, plus a
marketplace worker. Payments via [x402](https://x402.org) — USDC on Base, no accounts,
no API keys, settled straight to a self-custody wallet.

**Live:** https://www.blixtworks.com

## The toolbox

| Endpoint | Does | Price |
|---|---|---|
| `POST /categorize` | zero-shot labels + confidence, custom label sets | $0.02 |
| `POST /caption` | one-sentence image description | $0.02 |
| `POST /ocr` | printed-text extraction (English) | $0.03 |
| `POST /embed` | 512-dim CLIP vector | $0.01 |

Free: `GET /demo`, `GET /openapi.json`, `GET /.well-known/x402`, landing page.
Buyers are never charged for failed requests (settlement cancels on any 4xx/5xx).

## Architecture

- **Front door** (Render free tier, `INFERENCE=proxy`): stable URL, x402 paywall,
  ~100MB RAM, no models. Auto-deploys from this repo's master.
- **Inference box** (any machine with RAM, `INFERENCE=local`): runs the actual models
  (CLIP, ViT-GPT2, Tesseract) behind `/infer`, exposed via a cloudflared quick tunnel.
- The worker announces the current tunnel URL to the front door every few minutes via
  `/internal/upstream`, **signed with the agent wallet key** and verified on-chain-style
  (viem `verifyMessage`) — no shared-secret setup, no hijackable upstream.
- Front door offline-safe: no upstream → 503 → buyer not charged.

## Run the home side

```bash
./start.sh          # server (local mode) + tunnel + worker, idempotent
node src/status.js  # balances, sales, listings, current URLs
```

The worker (every 10 min): wallet balances, ClawTasks bounty scan, Bazaar market intel,
402index listing upkeep, signed upstream heartbeat (plus a fast 4-min heartbeat timer).

## Distribution

**MCP server:** `mcp/` — 10 tools with automatic x402 payment for any MCP client.

Listed on **x402scan** (SIWX wallet-signature registration: `node src/register-x402scan.js <url>`)
and **402index** (keyless, worker maintains it). PR to awesome-x402 pending. Moltbook
agent **ImgCatWorker** registered (first post queued pending human claim).

## Wallet

Self-custody, generated locally with viem — no exchange, no KYC. Address in `.env`
(`AGENT_ADDRESS`), private key in `.env` (`AGENT_PRIVATE_KEY`, mode 600). **Back up
`.env` — it is the money.** Import into any wallet app (network: Base) to withdraw.

## Ground rules

No botting human-only platforms, no fake engagement, no spam. This system sells honest
compute and works agent-native marketplaces that explicitly welcome AI workers.
