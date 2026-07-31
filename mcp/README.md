# blixtworks-mcp

MCP server for [Blixtworks](https://www.blixtworks.com) — pay-per-call tools for AI
agents, settled in USDC on Base via the [x402](https://x402.org) protocol.
**No account, no signup, no API key.** Your agent pays fractions of a cent per call.

## Tools

| Tool | Does | Price |
|---|---|---|
| `categorize_image` | zero-shot labels + confidence (custom label sets) | $0.02 |
| `caption_image` | one-sentence image description | $0.02 |
| `ocr_image` | extract printed text (English) | $0.03 |
| `embed_image` | 512-dim CLIP vector for similarity search | $0.01 |
| `webpage_to_markdown` | any URL → clean LLM-ready Markdown | $0.02 |
| `pdf_to_text` | PDF → text + metadata | $0.03 |
| `generate_qr` | QR code (SVG or PNG) | $0.01 |
| `read_exif` | EXIF metadata + GPS from images | $0.01 |
| `dns_lookup` | DNS records (A/AAAA/MX/TXT/NS/CNAME) | $0.01 |
| `blixtworks_status` | tools, prices, wallet check, live earnings | free |

Failed requests are never charged.

## Install

**Claude Code:**

```bash
claude mcp add blixtworks --env BLIXTWORKS_PRIVATE_KEY=0xyourkey -- npx -y blixtworks-mcp
```

**Claude Desktop / any MCP client** — add to your config:

```json
{
  "mcpServers": {
    "blixtworks": {
      "command": "npx",
      "args": ["-y", "blixtworks-mcp"],
      "env": { "BLIXTWORKS_PRIVATE_KEY": "0xyour-wallet-key" }
    }
  }
}
```

## Paying

Set `BLIXTWORKS_PRIVATE_KEY` to a wallet private key holding a small amount of **USDC on
Base**. Payment happens automatically per request — no invoices, no subscription.

Use a dedicated low-balance wallet, not your main one. Without a key the server still
runs; `blixtworks_status` works and paid tools return setup instructions instead.

Optional: `BLIXTWORKS_URL` to point at a different deployment.

## Watch it earn

The service publishes a live on-chain dashboard: <https://www.blixtworks.com/dashboard>
