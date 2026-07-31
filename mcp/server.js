#!/usr/bin/env node
/**
 * Blixtworks MCP server — exposes the pay-per-call toolbox to any MCP client
 * (Claude Code, Claude Desktop, Codex, …).
 *
 * Payment is handled automatically: point BLIXTWORKS_PRIVATE_KEY at a wallet
 * holding a little USDC on Base and calls just work. Without a key the server
 * still runs — free tools work, paid ones return a clear setup message.
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
  "This tool costs $0.01–$0.03, paid automatically in USDC on Base via the x402 protocol. " +
  "To enable it, set BLIXTWORKS_PRIVATE_KEY in the MCP server config to a wallet key holding a little USDC on Base. " +
  "No account or signup is needed — payment happens per request.";

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
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 402) {
      // Payment was signed but rejected — surface the actual reason.
      let reason = "payment rejected";
      try {
        const header = res.headers.get("payment-required");
        if (header) reason = JSON.parse(Buffer.from(header, "base64").toString()).error ?? reason;
      } catch { /* keep default */ }
      const friendly = reason.includes("insufficient_balance")
        ? `Payment failed: wallet ${walletAddress} has too little USDC on Base. Top it up with a dollar or two — calls cost $0.01–$0.03 each.`
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

const server = new McpServer({ name: "blixtworks", version: "1.0.0" });

const imageArg = z.string().describe("Image as an https URL or a data:image/...;base64 URI");

server.registerTool(
  "categorize_image",
  {
    title: "Categorize image ($0.02)",
    description:
      "Zero-shot image categorization. Returns ranked labels with confidence scores. Supply your own candidate labels or use a sensible default set. Costs $0.02 in USDC on Base.",
    inputSchema: {
      image: imageArg,
      labels: z.array(z.string()).min(2).max(50).optional().describe("Optional candidate labels (2-50)"),
    },
  },
  ({ image, labels }) => callTool("categorize", { image, labels }),
);

server.registerTool(
  "caption_image",
  {
    title: "Caption image ($0.02)",
    description: "Generate a one-sentence natural-language description of an image. Costs $0.02 in USDC on Base.",
    inputSchema: { image: imageArg },
  },
  ({ image }) => callTool("caption", { image }),
);

server.registerTool(
  "ocr_image",
  {
    title: "OCR image ($0.03)",
    description: "Extract printed English text from an image, with a confidence score. Costs $0.03 in USDC on Base.",
    inputSchema: { image: imageArg },
  },
  ({ image }) => callTool("ocr", { image }),
);

server.registerTool(
  "embed_image",
  {
    title: "Embed image ($0.01)",
    description:
      "Compute a 512-dimensional CLIP embedding for an image, for similarity search or clustering. Costs $0.01 in USDC on Base.",
    inputSchema: { image: imageArg },
  },
  ({ image }) => callTool("embed", { image }),
);

server.registerTool(
  "webpage_to_markdown",
  {
    title: "Webpage to Markdown ($0.02)",
    description:
      "Fetch a webpage (or convert raw HTML) into clean, LLM-ready Markdown with the boilerplate stripped. Costs $0.02 in USDC on Base.",
    inputSchema: {
      url: z.string().url().optional().describe("Page URL to fetch"),
      html: z.string().optional().describe("Raw HTML instead of a URL"),
      mode: z.enum(["article", "full"]).optional().describe("article = readability extract (default), full = whole body"),
    },
  },
  ({ url, html, mode }) => callTool("md", { url, html, mode }),
);

server.registerTool(
  "pdf_to_text",
  {
    title: "PDF to text ($0.03)",
    description: "Extract plain text, page count and metadata from a PDF. Costs $0.03 in USDC on Base.",
    inputSchema: { pdf: z.string().describe("PDF as an https URL or data:application/pdf;base64 URI") },
  },
  ({ pdf }) => callTool("pdf", { pdf }),
);

server.registerTool(
  "generate_qr",
  {
    title: "Generate QR code ($0.01)",
    description: "Generate a QR code as an SVG string or PNG data URI. Costs $0.01 in USDC on Base.",
    inputSchema: {
      text: z.string().max(2000).describe("Content to encode"),
      format: z.enum(["svg", "png"]).optional().describe("Output format (default svg)"),
    },
  },
  ({ text, format }) => callTool("qr", { text, format }),
);

server.registerTool(
  "read_exif",
  {
    title: "Read EXIF metadata ($0.01)",
    description:
      "Extract EXIF metadata from an image: camera make/model, timestamps, exposure settings and GPS coordinates when present. Costs $0.01 in USDC on Base.",
    inputSchema: { image: imageArg },
  },
  ({ image }) => callTool("exif", { image }),
);

server.registerTool(
  "dns_lookup",
  {
    title: "DNS lookup ($0.01)",
    description: "Resolve DNS records for a domain (A, AAAA, MX, TXT, NS, CNAME, or all). Costs $0.01 in USDC on Base.",
    inputSchema: {
      domain: z.string().describe("Domain name, e.g. example.com"),
      type: z.enum(["A", "AAAA", "MX", "TXT", "NS", "CNAME", "all"]).optional().describe("Record type (default all)"),
    },
  },
  ({ domain, type }) => callTool("dns", { domain, type }),
);

server.registerTool(
  "blixtworks_status",
  {
    title: "Service status (free)",
    description:
      "Free: list available Blixtworks tools with prices, check whether a payment wallet is configured, and see live earnings.",
    inputSchema: {},
  },
  async () => {
    await getFetch();
    let dash = {};
    try {
      dash = await (await fetch(`${BASE_URL}/dashboard.json`, { signal: AbortSignal.timeout(40000) })).json();
    } catch { /* offline */ }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              service: BASE_URL,
              paymentWallet: walletAddress ?? (PRIVATE_KEY ? `error: ${walletError}` : "not configured — set BLIXTWORKS_PRIVATE_KEY"),
              tools: dash.tools ?? null,
              lifetimeEarningsUsd: dash.incoming?.totalUsd ?? null,
              dashboard: `${BASE_URL}/dashboard`,
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
