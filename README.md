# agent-hustle

An autonomous money system with two income paths, one wallet, zero marginal cost.

## What it is

1. **Paid API (the product):** `img-categorize` — zero-shot image categorization running a
   local CLIP model (no per-call cost). Buyers (humans or other AI agents) pay **$0.005
   USDC on Base per call** through the [x402 payment protocol](https://x402.org) — no
   accounts, no API keys, payment settles on-chain straight to the agent wallet.
2. **Marketplace worker:** a loop that every 15 min checks wallet balances, scans the
   [ClawTasks](https://clawtasks.com) agent bounty board for autonomously-doable work
   (logged to `data/opportunities.jsonl`), and scans the x402 Bazaar for market intel.

## The wallet

- Address: see `AGENT_ADDRESS` in `.env`
- Private key: `AGENT_PRIVATE_KEY` in `.env` (mode 600). **This file is the money — back
  it up somewhere safe. Anyone with the key can take the funds.**
- Import into MetaMask/Rabby (network: Base) any time to withdraw.

## Run it

```bash
./start.sh          # starts server + tunnel + worker (idempotent)
node src/status.js  # wallet balance, sales, opportunities, public URL
```

Logs live in `data/`: `server.log`, `worker.jsonl`, `ledger.jsonl` (sales),
`opportunities.jsonl` (doable bounties), `tunnel.log`.

## Buying a call (how customers use it)

Any x402 client works, e.g. `@x402/fetch` with a funded wallet:

```
POST <public-url>/categorize
{"image": "https://...jpg", "labels": ["cat", "dog", "car"]}   # labels optional
→ 402 with payment requirements → client pays $0.005 USDC → results
```

## Known limits / next steps

- **Tunnel URL is ephemeral** — it changes if cloudflared restarts. Fix: free Cloudflare
  account + named tunnel, or deploy to a free host. Until then the URL is unstable, which
  hurts discovery.
- **Bazaar listing**: a free Coinbase Developer Platform account (CDP API keys) switches
  the facilitator to Coinbase's and gets the service auto-indexed in the x402 Bazaar,
  where agent buyers actually search. Biggest marketing lever, ~5 min of human signup.
- **ClawTasks claiming** needs (a) ~$5-10 USDC in the wallet for the 10% claim stakes and
  gas, (b) agent registration + a Moltbook verification post. Worker currently
  scans/scores only.
- **Machine must stay on** (WSL). A $0-5/mo VPS or free-tier host removes that.

## Ground rules baked in

No botting of human-only platforms (MTurk etc.), no fake engagement, no spam. This
system only sells honest compute and works agent-native marketplaces that explicitly
welcome AI workers.
