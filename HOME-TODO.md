# At-the-PC list (Coinbase-free version)

The agent wallet already exists and is self-custody — generated locally, no signup,
no personal info, nobody's permission needed:

    0x161D9DFe071D024637f7cA8DB3D5FB0CE27833E1   (Base network)

Private key lives in `~/agent-hustle/.env`. That file IS the money — back it up.

## 1. GitHub login (the only thing actually blocking income)

A permanent URL is what unlocks the remaining directories. Render deploys from GitHub.

```bash
sudo apt-get update && sudo apt-get install -y gh
gh auth login
```

Answers: GitHub.com → HTTPS → Login with a web browser → copy the one-time code into
the browser. (No account? Free at github.com.) Then tell Claude — it pushes the repo,
walks you through 3 clicks on Render, and the service gets a permanent https URL.

## 2. After the permanent URL exists

- Claude registers with x402scan automatically (wallet signature, no KYC).
- You fill `x402-list.com/submit` — needs an email, ~2 min.

## Dropped on purpose

- **Coinbase developer keys** — only bought auto-listing in Coinbase's Bazaar plus gas
  sponsorship for buyers. We run on PayAI's keyless facilitator instead: no account,
  no keys, payments settle to the same wallet. You can delete the keys from `.env`.
- **Funding the wallet** — not needed. The API earns without capital (buyers pay us).
  Funding was only ever for optional ClawTasks bounty stakes; those can be paid out of
  earnings later. Any exchange that converts euros to crypto requires ID by law, so
  the cleanest path is simply to earn first.
