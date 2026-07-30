import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { verifyMessage } from "viem";
import { record, summary } from "./ledger.js";

const { AGENT_ADDRESS, X402_FACILITATOR, X402_NETWORK, INFER_TOKEN } = process.env;
const INFERENCE = process.env.INFERENCE || "local"; // "local" (runs model) | "proxy" (forwards to local via tunnel)
const PORT = Number(process.env.PORT) || 4021;
const PRICE = "$0.005";
const PRICE_USD = 0.005;

if (!AGENT_ADDRESS) throw new Error("AGENT_ADDRESS missing from env");

const DESCRIPTION =
  "Zero-shot image categorization (CLIP). POST JSON {\"image\": \"<https url or data URI>\", \"labels\": [\"optional\", \"custom\", \"labels\"]} -> ranked labels with confidence scores.";

const DEFAULT_LABELS = [
  "photo of a person", "photo of an animal", "photo of food",
  "photo of a vehicle", "landscape or nature scene", "building or architecture",
  "screenshot of a user interface", "document or text", "chart or diagram",
  "product photo", "artwork or illustration", "logo or icon",
  "meme", "adult or explicit content", "medical image",
];

// In proxy mode the model never loads (fits small hosts); inference happens on
// the upstream box, announced via wallet-signed heartbeats to /internal/upstream.
let upstream = null; // { url, token, ts }
let local = null;
if (INFERENCE === "local") {
  local = await import("./classifier.js");
}

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "12mb" }));

const facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme());

const paidRoute = {
  accepts: { scheme: "exact", price: PRICE, network: X402_NETWORK, payTo: AGENT_ADDRESS },
  description: DESCRIPTION,
};

app.use(
  paymentMiddleware(
    { "POST /categorize": paidRoute, "GET /categorize": paidRoute },
    resourceServer,
  ),
);

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

async function runInference(image, labels) {
  if (INFERENCE === "local") return local.categorize(image, labels);
  if (!upstream) throw Object.assign(new Error("inference backend offline"), { status: 503 });
  const res = await fetch(`${upstream.url}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${upstream.token}` },
    body: JSON.stringify({ image, labels }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (!res || !res.ok) throw Object.assign(new Error("inference backend unavailable"), { status: 503 });
  const { results } = await res.json();
  return results;
}

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>img-categorize — pay-per-call image categorization</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fafafa; --muted:#666; --card:#fff; --line:#e5e5e5; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --bg:#111; --muted:#999; --card:#1c1c1c; --line:#2a2a2a; --accent:#60a5fa; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; color:var(--fg); background:var(--bg); line-height:1.6; }
  main { max-width: 720px; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 1.9rem; margin: 0 0 .25rem; }
  .tag { color: var(--muted); margin: 0 0 2rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.25rem 1.5rem; margin:1rem 0; }
  .price { font-size:1.4rem; font-weight:700; }
  code, pre { font-family: ui-monospace, monospace; font-size:.85rem; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:1rem; overflow-x:auto; }
  button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:.6rem 1.1rem; font-size:1rem; cursor:pointer; }
  button:disabled { opacity:.6; cursor:wait; }
  #demo-out { white-space:pre-wrap; margin-top:.75rem; }
  a { color: var(--accent); }
  .foot { color:var(--muted); font-size:.85rem; margin-top:2.5rem; }
</style>
</head>
<body>
<main>
  <h1>img-categorize</h1>
  <p class="tag">Zero-shot image categorization for AI agents and apps. No account. No API key. Pay per call.</p>

  <div class="card">
    <span class="price">$0.005</span> per image · USDC on Base · paid via the <a href="https://x402.org">x402 protocol</a>
  </div>

  <div class="card">
    <strong>Try it free</strong>
    <p>Runs the real model on a sample image.</p>
    <button id="demo-btn" onclick="runDemo()">Run demo</button>
    <div id="demo-out"></div>
  </div>

  <div class="card">
    <strong>Use it</strong>
<pre>POST /categorize
{ "image": "https://…/photo.jpg",
  "labels": ["cat", "dog", "car"] }   // optional

→ 402 with payment details → pay $0.005 USDC →
{ "results": [ { "label": "cat", "score": 0.91 }, … ] }</pre>
    <p>Any x402 client handles payment automatically. Machine-readable spec: <a href="/openapi.json">openapi.json</a></p>
  </div>

  <p class="foot">Custom labels (2–50) or a sensible default set · CLIP under the hood · buyers are never charged for failed requests</p>
</main>
<script>
async function runDemo() {
  const btn = document.getElementById('demo-btn'), out = document.getElementById('demo-out');
  btn.disabled = true; out.textContent = 'running…';
  try {
    const r = await fetch('/demo'); const j = await r.json();
    out.textContent = j.results ? j.results.slice(0,5).map(x => x.label + '  ' + (100*x.score).toFixed(1) + '%').join('\\n') : JSON.stringify(j);
  } catch { out.textContent = 'demo unavailable right now'; }
  btn.disabled = false;
}
</script>
</body>
</html>`;

app.get("/", (req, res) => {
  if (req.accepts(["json", "html"]) === "html") {
    return res.type("html").send(LANDING_HTML);
  }
  res.json({
    service: "img-categorize",
    description:
      "Zero-shot image categorization for agents and apps. Pay per call via x402 (USDC on Base). No account, no API key.",
    endpoints: {
      "POST /categorize": {
        price: PRICE,
        network: X402_NETWORK,
        payment: "x402",
        input: { image: "https URL or data:image/... URI", labels: "optional string[] (2-50), defaults provided" },
        output: [{ label: "string", score: "0..1" }],
      },
      "GET /demo": "free sample result",
    },
    defaultLabels: DEFAULT_LABELS,
    payTo: AGENT_ADDRESS,
  });
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: INFERENCE, backend: INFERENCE === "local" || Boolean(upstream), ...summary() }),
);

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
          "x-payment": { protocol: "x402", price: PRICE, network: X402_NETWORK },
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

const DEMO_IMAGE = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg";
let demoCache = null;
app.get("/demo", async (_req, res) => {
  try {
    demoCache ??= await runInference(DEMO_IMAGE);
    res.json({
      note: "Free demo: default labels on a fixed sample image. POST /categorize ($0.005 via x402) for your own images and labels.",
      sampleImage: DEMO_IMAGE,
      results: demoCache,
    });
  } catch {
    res.status(503).json({ error: "demo temporarily unavailable" });
  }
});

app.get("/categorize", (req, res) => {
  res.json({ usage: "POST /categorize with JSON body", openapi: openapiDoc(req) });
});

app.post("/categorize", async (req, res) => {
  const { image, labels } = req.body ?? {};
  if (!validImage(image)) {
    return res.status(400).json({ error: "body.image must be an https URL or data:image URI" });
  }
  try {
    const results = await runInference(image, labels);
    record({ type: "sale", route: "POST /categorize", priceUsd: PRICE_USD });
    res.json({ results });
  } catch (err) {
    record({ type: "error", route: "POST /categorize", message: String(err?.message ?? err) });
    res.status(err?.status ?? 422).json({ error: err?.status === 503 ? "backend unavailable, you were not charged" : "could not process image" });
  }
});

// --- internal endpoints (not paywalled, not in discovery docs) ---

if (INFERENCE === "local") {
  // Free inference for the trusted proxy front door; bearer token gates it.
  app.post("/infer", async (req, res) => {
    if (!INFER_TOKEN || req.headers.authorization !== `Bearer ${INFER_TOKEN}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { image, labels } = req.body ?? {};
    if (!validImage(image) && image !== DEMO_IMAGE) {
      return res.status(400).json({ error: "invalid image" });
    }
    try {
      res.json({ results: await local.categorize(image, labels) });
    } catch {
      res.status(422).json({ error: "could not process image" });
    }
  });
} else {
  // Wallet-signed heartbeat from the inference box: {url, token, ts} + signature.
  app.post("/internal/upstream", async (req, res) => {
    const { url, token, ts, signature } = req.body ?? {};
    if (!url || !token || !ts || !signature) return res.status(400).json({ error: "bad heartbeat" });
    if (Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) {
      return res.status(400).json({ error: "stale heartbeat" });
    }
    try {
      const valid = await verifyMessage({
        address: AGENT_ADDRESS,
        message: JSON.stringify({ url, token, ts }),
        signature,
      });
      if (!valid) return res.status(401).json({ error: "bad signature" });
    } catch {
      return res.status(401).json({ error: "bad signature" });
    }
    upstream = { url, token, ts };
    res.json({ ok: true });
  });
}

app.listen(PORT, async () => {
  console.log(`img-categorize listening on :${PORT} mode=${INFERENCE}`);
  console.log(`payTo=${AGENT_ADDRESS} facilitator=${X402_FACILITATOR}`);
  if (INFERENCE === "local") {
    console.log("warming up model...");
    const t0 = Date.now();
    await local.getClassifier();
    console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
});
