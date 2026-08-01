// Remote MCP endpoint (streamable HTTP) mounted at /mcp.
//
// Zero-install: any MCP client can connect with no signup, browse the
// catalogue, run a free sample, and buy any of the paid tools by paying from
// its own wallet and passing the transaction hash. We never ask anyone to hand
// over a private key — that is what the local stdio server is for.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TASK_META } from "./catalog.js";
import { chargeCall, creditFor, fromMicros, redeemPayment, refundCredit } from "./mcp-payments.js";

const INSTALL_CMD = "claude mcp add blixtworks --env BLIXTWORKS_PRIVATE_KEY=0xyourkey -- npx -y blixtworks-mcp";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function payInstructions({ tool, priceUsd, payTo, siteUrl }) {
  return [
    `${tool} costs $${priceUsd} (USDC on Base). Nothing has been charged.`,
    "",
    "To run it, pay from your own wallet and call this tool again with the transaction hash:",
    `  1. Send at least ${priceUsd} USDC on Base to ${payTo}`,
    `     USDC contract: ${USDC}`,
    "  2. Call this tool again with paymentTx set to your transaction hash.",
    "",
    "Overpaying is fine — the surplus becomes credit for further calls from the same wallet,",
    "and you can pass payerAddress instead of paymentTx to spend it. Credit is held in memory,",
    "expires after an hour and does not survive a server restart, so pay roughly what you plan to use.",
    "",
    `Want to try before paying? Every non-vision tool serves 5 free calls per caller per day over plain HTTP:`,
    `  curl -X POST ${siteUrl}/${typeof tool === "string" && tool !== "Each tool" ? tool : "hash"} -H 'content-type: application/json' -d '{}'`,
    "",
    `Prefer automatic payment? The local server handles all of this for you: ${INSTALL_CMD}`,
    `Catalogue and prices: ${siteUrl}/catalog.json`,
  ].join("\n");
}

/** Loose schema derived from the catalogue example, plus payment fields. */
function inputSchemaFor(example) {
  const shape = {
    paymentTx: z.string().optional().describe("Transaction hash of your USDC payment on Base (see how_to_pay)"),
    payerAddress: z.string().optional().describe("Your wallet address, to spend existing credit without a new payment"),
  };
  for (const [key, value] of Object.entries(example ?? {})) {
    if (Array.isArray(value)) shape[key] = z.array(z.string()).optional();
    else if (typeof value === "number") shape[key] = z.number().optional();
    else if (typeof value === "boolean") shape[key] = z.boolean().optional();
    else if (value && typeof value === "object") shape[key] = z.object({}).passthrough().optional();
    else shape[key] = z.string().optional();
  }
  return shape;
}

export function createRemoteMcp({ runTask, runDemo, siteUrl, payTo }) {
  const toolNames = Object.keys(TASK_META);
  const server = new McpServer(
    {
      name: "blixtworks",
      title: "Blixtworks — pay-per-call tools for agents",
      version: "2.0.0",
      websiteUrl: siteUrl,
    },
    {
      instructions:
        `Blixtworks provides ${toolNames.length} tools for AI agents, billed per call in USDC on Base ($0.005–$0.03). ` +
        "No account, no signup, no API key, and failed requests are never charged. " +
        "Groups: vision (image categorization, captioning, OCR, CLIP embeddings), images (resize, crop, transform, palette, EXIF, QR), " +
        "text (hashing, regex, diff, language detection, statistics), data formats (JSON/YAML/CSV/XML/Markdown, JWT, RSS, PDF), " +
        "web (HTTP headers, TLS certificates, WHOIS, DNS, robots.txt, page metadata, email validation), " +
        "convert/validate (units, currency, timezones, cron, IBAN, phone numbers, colours) and read-only blockchain lookups. " +
        "Paid tools run when you pass paymentTx — a hash of a USDC payment you made from your own wallet. Call how_to_pay for the exact steps. " +
        "list_tools and try_sample are free, and every non-vision tool also serves 5 free calls per caller per day over plain HTTP at the same URLs — see how_to_pay.",
    },
  );

  // --- free tools ---

  server.registerTool(
    "list_tools",
    {
      title: "List tools and prices (free)",
      description: `Free: every Blixtworks tool with price, inputs and description (${toolNames.length} tools). Optionally filter by group.`,
      inputSchema: { group: z.string().optional().describe("vision, media, text, data, web, convert or chain") },
    },
    async ({ group }) => {
      const entries = Object.entries(TASK_META).filter(([, m]) => !group || m.group === group);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                toolCount: entries.length,
                payment: { protocol: "x402 or direct USDC transfer", network: "Base", asset: "USDC", payTo },
                tools: entries.map(([name, m]) => ({
                  name, group: m.group, price: m.price, description: m.description, example: m.example ?? {},
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "try_sample",
    {
      title: "Run a free sample (free)",
      description: "Free: runs the real CLIP model on a sample image so you can judge output quality before paying.",
      inputSchema: {},
    },
    async () => {
      try {
        const results = await runDemo();
        return { content: [{ type: "text", text: JSON.stringify({ sample: "categorize", results }, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: "Sample temporarily unavailable — try again shortly." }], isError: true };
      }
    },
  );

  server.registerTool(
    "how_to_pay",
    {
      title: "How to pay (free)",
      description: "Free: exact payment steps, the receiving address, and how credit works.",
      inputSchema: { tool: z.string().optional().describe("Get the exact price for one tool") },
    },
    async ({ tool }) => {
      const meta = tool && TASK_META[tool];
      return {
        content: [
          {
            type: "text",
            text: payInstructions({
              tool: meta ? tool : "Each tool",
              priceUsd: meta ? meta.priceUsd : "0.005–0.03",
              payTo,
              siteUrl,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "check_credit",
    {
      title: "Check remaining credit (free)",
      description: "Free: how much unspent credit a wallet address currently has with this endpoint.",
      inputSchema: { address: z.string().describe("Your wallet address") },
    },
    async ({ address }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { address, creditUsd: fromMicros(creditFor(address)), note: "In-memory credit; expires after 1 hour or on restart." },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "redeem_payment",
    {
      title: "Redeem a payment into credit (free)",
      description:
        "Turn a USDC payment you already made into credit you can spend across multiple tool calls. Pass the transaction hash.",
      inputSchema: { paymentTx: z.string().describe("Transaction hash of your USDC payment on Base") },
    },
    async ({ paymentTx }) => {
      const result = await redeemPayment(paymentTx, payTo);
      if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                redeemed: `$${fromMicros(result.paid)}`,
                payer: result.payer,
                creditUsd: fromMicros(creditFor(result.payer)),
                note: `Call any paid tool with payerAddress: "${result.payer}" to spend this credit.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // --- paid tools ---

  for (const [name, meta] of Object.entries(TASK_META)) {
    server.registerTool(
      name,
      {
        title: `${name} (${meta.price})`,
        description: `${meta.description} Costs ${meta.price} in USDC on Base — pass paymentTx or payerAddress to pay (call how_to_pay for details).`,
        inputSchema: inputSchemaFor(meta.example),
      },
      async ({ paymentTx, payerAddress, ...args }) => {
        if (!paymentTx && !payerAddress) {
          return {
            content: [{ type: "text", text: payInstructions({ tool: name, priceUsd: meta.priceUsd, payTo, siteUrl }) }],
            isError: true,
          };
        }
        const charge = await chargeCall({
          paymentTx,
          payerHint: payerAddress,
          priceUsd: meta.priceUsd,
          payTo,
        });
        if (!charge.ok) {
          return {
            content: [{ type: "text", text: `${charge.error}\n\n${payInstructions({ tool: name, priceUsd: meta.priceUsd, payTo, siteUrl })}` }],
            isError: true,
          };
        }
        try {
          const result = await runTask(name, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { result, charged: meta.price, remainingCreditUsd: fromMicros(charge.remaining), payer: charge.payer },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          refundCredit(charge.payer, meta.priceUsd);
          return {
            content: [{ type: "text", text: `Tool failed: ${String(err?.message ?? err)}. Your credit was refunded.` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

/**
 * Express handler for stateless streamable-HTTP MCP requests.
 * A fresh transport per request keeps it simple and horizontally scalable.
 */
export function mcpHandler(opts) {
  return async (req, res) => {
    try {
      const server = createRemoteMcp(opts);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  };
}
