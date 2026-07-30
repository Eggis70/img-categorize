import "dotenv/config";
import express from "express";
import { paymentMiddleware, paymentMiddlewareFromHTTPServer, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { categorize, getClassifier, DEFAULT_LABELS, MODEL } from "./classifier.js";
import { record, summary } from "./ledger.js";

const { AGENT_ADDRESS, X402_FACILITATOR, X402_NETWORK, CDP_API_KEY_ID, CDP_API_KEY_SECRET } = process.env;
const PORT = Number(process.env.PORT) || 4021;
const PRICE = "$0.005";
const PRICE_USD = 0.005;

if (!AGENT_ADDRESS) throw new Error("AGENT_ADDRESS missing from .env");

const DESCRIPTION =
  "Zero-shot image categorization (CLIP). POST JSON {\"image\": \"<https url or data URI>\", \"labels\": [\"optional\", \"custom\", \"labels\"]} -> ranked labels with confidence scores.";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "12mb" }));

async function cdpKeysValid() {
  if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) return false;
  try {
    const { generateJwt } = await import("@coinbase/cdp-sdk/auth");
    await generateJwt({
      apiKeyId: CDP_API_KEY_ID,
      apiKeySecret: CDP_API_KEY_SECRET,
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/",
    });
    return true;
  } catch (err) {
    console.warn(`CDP keys present but unusable (${err.message}) — falling back to keyless facilitator`);
    return false;
  }
}

const useCdp = await cdpKeysValid();

if (useCdp) {
  // Coinbase facilitator: settles on Base mainnet, sponsors buyer gas, and
  // auto-lists the route in the x402 Bazaar discovery index.
  const { createX402Server } = await import("@coinbase/cdp-sdk/x402");
  const cdpServer = await createX402Server({
    routes: {
      "POST /categorize": { price: PRICE, description: DESCRIPTION },
      "GET /categorize": { price: PRICE, description: DESCRIPTION },
    },
    payToConfig: { type: "address", evm: AGENT_ADDRESS },
  });
  app.use(paymentMiddlewareFromHTTPServer(cdpServer));
} else {
  const facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(X402_NETWORK, new ExactEvmScheme());
  app.use(
    paymentMiddleware(
      {
        "POST /categorize": {
          accepts: { scheme: "exact", price: PRICE, network: X402_NETWORK, payTo: AGENT_ADDRESS },
          description: DESCRIPTION,
        },
        "GET /categorize": {
          accepts: { scheme: "exact", price: PRICE, network: X402_NETWORK, payTo: AGENT_ADDRESS },
          description: DESCRIPTION,
        },
      },
      resourceServer,
    ),
  );
}

const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1)/i;

function validImage(image) {
  if (typeof image !== "string" || image.length > 15_000_000) return false;
  if (image.startsWith("data:image/")) return true;
  try {
    const u = new URL(image);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (BLOCKED_HOSTS.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

app.get("/", (_req, res) => {
  res.json({
    service: "img-categorize",
    description:
      "Zero-shot image categorization for agents and apps. Pay per call via x402 (USDC on Base). No account, no API key.",
    model: MODEL,
    endpoints: {
      "POST /categorize": {
        price: PRICE,
        network: X402_NETWORK,
        payment: "x402",
        input: { image: "https URL or data:image/... URI", labels: "optional string[] (2-50), defaults provided" },
        output: [{ label: "string", score: "0..1" }],
      },
    },
    defaultLabels: DEFAULT_LABELS,
    payTo: AGENT_ADDRESS,
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, ...summary() }));

// Discovery documents so x402 indexers (x402scan, 402 Index, Bazaar crawlers)
// can find and verify the paid endpoint. Origin is derived per-request so the
// spec stays correct if the public URL changes.
function openapiDoc(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return {
    openapi: "3.0.3",
    info: {
      title: "img-categorize",
      version: "1.0.0",
      description:
        "Zero-shot image categorization (CLIP) paid per-call via x402: $0.005 USDC on Base. No accounts or API keys.",
    },
    servers: [{ url: origin }],
    paths: {
      "/categorize": {
        post: {
          summary: "Categorize an image against default or custom labels",
          "x-payment": { protocol: "x402", price: "$0.005", network: "eip155:8453" },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["image"],
                  properties: {
                    image: { type: "string", description: "https URL or data:image URI" },
                    labels: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 50 },
                  },
                },
                example: { image: "https://example.com/photo.jpg", labels: ["cat", "dog", "car"] },
              },
            },
          },
          responses: {
            200: {
              description: "Ranked labels with confidence scores",
              content: {
                "application/json": {
                  example: { results: [{ label: "cat", score: 0.91 }, { label: "dog", score: 0.07 }] },
                },
              },
            },
            402: { description: "x402 payment required" },
          },
        },
      },
    },
  };
}

app.get("/openapi.json", (req, res) => res.json(openapiDoc(req)));
app.get("/.well-known/x402", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({
    x402Version: 2,
    resources: [{ url: `${origin}/categorize`, method: "POST", description: DESCRIPTION }],
  });
});

// Free demo on a fixed sample image so buyers can judge quality before paying.
let demoCache = null;
app.get("/demo", async (_req, res) => {
  try {
    demoCache ??= await categorize("https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg");
    res.json({
      note: "Free demo: default labels on a fixed sample image. POST /categorize ($0.005 via x402) for your own images and labels.",
      sampleImage: "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg",
      results: demoCache,
    });
  } catch {
    res.status(503).json({ error: "demo temporarily unavailable" });
  }
});

app.get("/categorize", (req, res) => {
  // Paid GET returns full usage docs (probes see 402 via the middleware above).
  res.json({ usage: "POST /categorize with JSON body", openapi: openapiDoc(req) });
});

app.post("/categorize", async (req, res) => {
  const { image, labels } = req.body ?? {};
  if (!validImage(image)) {
    return res.status(400).json({ error: "body.image must be an https URL or data:image URI" });
  }
  try {
    const results = await categorize(image, labels);
    record({ type: "sale", route: "POST /categorize", priceUsd: PRICE_USD });
    res.json({ results });
  } catch (err) {
    record({ type: "error", route: "POST /categorize", message: String(err?.message ?? err) });
    res.status(422).json({ error: "could not process image" });
  }
});

app.listen(PORT, async () => {
  console.log(`img-categorize listening on :${PORT}`);
  console.log(`payTo=${AGENT_ADDRESS} mode=${useCdp ? "coinbase-cdp (bazaar-listed)" : `keyless (${X402_FACILITATOR})`}`);
  console.log("warming up model...");
  const t0 = Date.now();
  await getClassifier();
  console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
});
