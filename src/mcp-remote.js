// Remote MCP endpoint (streamable HTTP) mounted at /mcp.
//
// This is the zero-install shop window: any MCP client can connect with no
// wallet and no signup, browse the catalogue, and run a real sample through the
// live models. Paid tools need the caller's own wallet, which stdio handles
// safely — so this endpoint hands out install instructions rather than asking
// anyone to send us a private key.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { TASK_META } from "./catalog.js";

const INSTALL_CMD = "claude mcp add blixtworks --env BLIXTWORKS_PRIVATE_KEY=0xyourkey -- npx -y blixtworks-mcp";

export function createRemoteMcp({ runDemo, siteUrl }) {
  const server = new McpServer(
    {
      name: "blixtworks",
      title: "Blixtworks — pay-per-call tools for agents",
      version: "1.0.0",
      websiteUrl: siteUrl,
    },
    {
      instructions:
        "Blixtworks sells nine tools for AI agents, charged per request in USDC on Base via the x402 protocol — no account, no signup, no API key, and failed requests are never charged. " +
        "Available: image categorization with custom labels, image captioning, OCR, CLIP embeddings, webpage-to-Markdown, PDF text extraction, QR code generation, EXIF/GPS metadata, and DNS lookups ($0.002–$0.01 each). " +
        "Call list_tools for the catalogue and prices, try_sample to see real model output for free, and how_to_pay to start buying. " +
        "This remote endpoint is free; paid tools run through the local MCP server (npx -y blixtworks-mcp) so your wallet key never leaves your machine.",
    },
  );

  server.registerTool(
    "list_tools",
    {
      title: "List Blixtworks tools and prices (free)",
      description:
        "List every tool Blixtworks sells, with prices and input formats. Free — no wallet needed. Covers image categorization, captioning, OCR, CLIP embeddings, webpage-to-Markdown, PDF extraction, QR codes, EXIF/GPS and DNS lookups.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tools: Object.fromEntries(
                Object.entries(TASK_META).map(([task, meta]) => [
                  task,
                  { price: meta.price, endpoint: `POST ${siteUrl}/${task}`, description: meta.description },
                ]),
              ),
              payment: "x402 — USDC on Base, per request, no account or API key",
              toUseThesePaidTools: INSTALL_CMD,
              npm: "blixtworks-mcp",
              docs: `${siteUrl}/llms.txt`,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "try_sample",
    {
      title: "Run a free sample categorization",
      description:
        "Free: runs the real CLIP model on a sample image and returns ranked labels, so you can judge output quality before paying for anything.",
      inputSchema: {},
    },
    async () => {
      try {
        const results = await runDemo();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { sample: "categorize", results, note: `For your own images: ${INSTALL_CMD}` },
                null,
                2,
              ),
            },
          ],
        };
      } catch {
        return { content: [{ type: "text", text: "Sample temporarily unavailable — try again shortly." }], isError: true };
      }
    },
  );

  server.registerTool(
    "how_to_pay",
    {
      title: "How payment works (free)",
      description:
        "Explains how to call the paid Blixtworks tools: the x402 flow, what a wallet needs, and the one-line install for the local MCP server that pays automatically.",
      inputSchema: { tool: z.string().optional().describe("Optional tool name to get a specific example for") },
    },
    async ({ tool }) => {
      const meta = tool && TASK_META[tool];
      return {
        content: [
          {
            type: "text",
            text: [
              "Blixtworks charges per request in USDC on Base via the x402 protocol. There is no signup, subscription or API key.",
              "",
              "Two ways to buy:",
              `1. Local MCP server (payment handled for you): ${INSTALL_CMD}`,
              "   Point BLIXTWORKS_PRIVATE_KEY at a dedicated low-balance wallet holding a little USDC on Base.",
              `2. Direct HTTP with any x402 client: POST ${siteUrl}/<tool>. You get HTTP 402 with payment requirements, your client pays, then the call succeeds.`,
              "",
              meta ? `${tool}: ${meta.price} — ${meta.description}` : `Tools: ${Object.keys(TASK_META).join(", ")}`,
              "",
              "Failed requests are never charged. Live earnings: " + `${siteUrl}/dashboard`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  return server;
}

/**
 * Express handler for stateless streamable-HTTP MCP requests.
 * A fresh transport per request keeps it simple and horizontally scalable.
 */
export function mcpHandler({ runDemo, siteUrl }) {
  return async (req, res) => {
    try {
      const server = createRemoteMcp({ runDemo, siteUrl });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };
}
