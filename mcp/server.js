#!/usr/bin/env node
/**
 * Blixtworks MCP server — exposes the pay-per-call toolbox to any MCP client
 * (Claude Code, Claude Desktop, Codex, …).
 *
 * The tool list is fetched from the live catalogue at startup, so new tools
 * appear without republishing this package.
 *
 * Payment is handled automatically: point BLIXTWORKS_PRIVATE_KEY at a wallet
 * holding a little USDC on Base and calls just work. Without a key the server
 * still runs — the catalogue tool works, paid ones return a setup message.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.BLIXTWORKS_URL ?? "https://www.blixtworks.com").replace(/\/$/, "");
const PRIVATE_KEY = process.env.BLIXTWORKS_PRIVATE_KEY;

let payFetch = null;
let walletAddress = null;
let walletError = null;

async function getFetch() {
  if (!PRIVATE_KEY) return null;
  if (payFetch || walletError) return payFetch;
  try {
    const [{ privateKeyToAccount }, { wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }] = await Promise.all([
      import("viem/accounts"),
      import("@x402/fetch"),
      import("@x402/evm/exact/client"),
    ]);
    const account = privateKeyToAccount(PRIVATE_KEY);
    walletAddress = account.address;
    payFetch = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
    });
    return payFetch;
  } catch (err) {
    walletError = String(err?.message ?? err);
    return null;
  }
}

const SETUP_HINT =
  "This tool is billed per request in USDC on Base via the x402 protocol ($0.005–$0.03). " +
  "To enable it, set BLIXTWORKS_PRIVATE_KEY in the MCP server config to a wallet key holding a little USDC on Base. " +
  "Use a dedicated low-balance wallet. No account or signup is needed.";

async function callTool(path, body) {
  const doFetch = await getFetch();
  if (!doFetch) {
    return {
      content: [{ type: "text", text: walletError ? `Wallet setup failed: ${walletError}\n\n${SETUP_HINT}` : SETUP_HINT }],
      isError: true,
    };
  }
  try {
    const res = await doFetch(`${BASE_URL}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    if (res.status === 402) {
      let reason = "payment rejected";
      try {
        const header = res.headers.get("payment-required");
        if (header) reason = JSON.parse(Buffer.from(header, "base64").toString()).error ?? reason;
      } catch { /* keep default */ }
      const friendly = reason.includes("insufficient_balance")
        ? `Payment failed: wallet ${walletAddress} has too little USDC on Base. Top it up with a dollar or two — calls cost $0.005–$0.03 each.`
        : `Payment failed: ${reason}`;
      return { content: [{ type: "text", text: friendly }], isError: true };
    }
    if (!res.ok) {
      return { content: [{ type: "text", text: `Request failed (${res.status}): ${text.slice(0, 500)}` }], isError: true };
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Call failed: ${String(err?.message ?? err)}` }], isError: true };
  }
}

/** Build a loose zod schema from the catalogue's example payload. */
function schemaFromExample(example) {
  const shape = {};
  for (const [key, value] of Object.entries(example ?? {})) {
    if (Array.isArray(value)) shape[key] = z.array(z.string()).optional();
    else if (typeof value === "number") shape[key] = z.number().optional();
    else if (typeof value === "boolean") shape[key] = z.boolean().optional();
    else if (value && typeof value === "object") shape[key] = z.object({}).passthrough().optional();
    else shape[key] = z.string().optional();
  }
  return shape;
}

const FALLBACK_TOOLS = [
  { name: "categorize", price: "$0.02", group: "vision", description: "Zero-shot image categorization.", example: { image: "https://example.com/a.jpg" } },
  { name: "ocr", price: "$0.03", group: "vision", description: "Extract printed text from an image.", example: { image: "https://example.com/a.jpg" } },
  { name: "md", price: "$0.02", group: "web", description: "Webpage to clean Markdown.", example: { url: "https://example.com" } },
];

async function loadCatalog() {
  try {
    const res = await fetch(`${BASE_URL}/catalog.json`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.tools) && data.tools.length) return data.tools;
    throw new Error("empty catalogue");
  } catch {
    return FALLBACK_TOOLS;
  }
}

const catalog = await loadCatalog();

const server = new McpServer(
  { name: "blixtworks", title: "Blixtworks — pay-per-call tools for agents", version: "1.1.0" },
  {
    instructions:
      `Blixtworks provides ${catalog.length} tools for AI agents, billed per request in USDC on Base via x402 — ` +
      "no account, no API key, and failed requests are never charged. Groups: vision (image categorization, captioning, OCR, embeddings), " +
      "images (resize, crop, transform, palette, EXIF, QR), text (hashing, regex, diff, language detection, statistics), " +
      "data formats (JSON/YAML/CSV/XML/Markdown, JWT, RSS, PDF), web (HTTP headers, TLS certificates, WHOIS, DNS, robots.txt, page metadata, email validation), " +
      "convert/validate (units, currency, timezones, cron, IBAN, phone numbers, colours) and read-only blockchain lookups. " +
      "Call blixtworks_catalog for the full list with prices.",
  },
);

for (const tool of catalog) {
  const toolName = String(tool.name).replace(/[^a-zA-Z0-9_]/g, "_");
  server.registerTool(
    toolName,
    {
      title: `${toolName} (${tool.price})`,
      description: `${tool.description} Billed ${tool.price} in USDC on Base.`,
      inputSchema: schemaFromExample(tool.example),
    },
    (args) => callTool(tool.name, args),
  );
}

server.registerTool(
  "blixtworks_catalog",
  {
    title: "Catalogue and prices (free)",
    description:
      "Free: list every Blixtworks tool with its price and description, check whether a payment wallet is configured, and get the live dashboard link.",
    inputSchema: {
      group: z.string().optional().describe("Filter by group: vision, media, text, data, web, convert or chain"),
    },
  },
  async ({ group }) => {
    await getFetch();
    const tools = group ? catalog.filter((t) => t.group === group) : catalog;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              service: BASE_URL,
              toolCount: tools.length,
              paymentWallet: walletAddress ?? (PRIVATE_KEY ? `error: ${walletError}` : "not configured — set BLIXTWORKS_PRIVATE_KEY"),
              dashboard: `${BASE_URL}/dashboard`,
              tools: tools.map((t) => ({ name: t.name, group: t.group, price: t.price, description: t.description })),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
