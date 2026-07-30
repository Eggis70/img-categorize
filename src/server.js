import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { verifyMessage } from "viem";
import { record, summary } from "./ledger.js";
import { TASK_META } from "./tasks-meta.js";

const { AGENT_ADDRESS, X402_FACILITATOR, X402_NETWORK, INFER_TOKEN } = process.env;
const INFERENCE = process.env.INFERENCE || "local"; // "local" (runs models) | "proxy" (forwards to local via tunnel)
const PORT = Number(process.env.PORT) || 4021;

if (!AGENT_ADDRESS) throw new Error("AGENT_ADDRESS missing from env");

const DEFAULT_LABELS = [
  "photo of a person", "photo of an animal", "photo of food",
  "photo of a vehicle", "landscape or nature scene", "building or architecture",
  "screenshot of a user interface", "document or text", "chart or diagram",
  "product photo", "artwork or illustration", "logo or icon",
  "meme", "adult or explicit content", "medical image",
];

// In proxy mode the models never load (fits small hosts); inference happens on
// the upstream box, announced via wallet-signed heartbeats to /internal/upstream.
let upstream = null; // { url, token, ts }
let vision = null;
if (INFERENCE === "local") {
  vision = await import("./vision.js");
}

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "12mb" }));

const facilitatorClient = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme());

const paidRoutes = {};
for (const [task, meta] of Object.entries(TASK_META)) {
  const route = {
    accepts: { scheme: "exact", price: meta.price, network: X402_NETWORK, payTo: AGENT_ADDRESS },
    description: meta.description,
  };
  paidRoutes[`POST /${task}`] = route;
  paidRoutes[`GET /${task}`] = route; // directory probes GET; paid GET returns usage docs
}
app.use(paymentMiddleware(paidRoutes, resourceServer));

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

async function runTask(task, body) {
  if (INFERENCE === "local") return vision.runTask(task, body);
  if (!upstream) throw Object.assign(new Error("inference backend offline"), { status: 503 });
  const res = await fetch(`${upstream.url}/infer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${upstream.token}` },
    body: JSON.stringify({ task, ...body }),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  if (!res || res.status === 503 || !res.ok && res.status >= 500) {
    throw Object.assign(new Error("inference backend unavailable"), { status: 503 });
  }
  if (!res.ok) throw Object.assign(new Error("bad request"), { status: res.status });
  return res.json();
}

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>img-categorize — pay-per-call vision tools for agents</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fafafa; --muted:#666; --card:#fff; --line:#e5e5e5; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --bg:#111; --muted:#999; --card:#1c1c1c; --line:#2a2a2a; --accent:#60a5fa; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; color:var(--fg); background:var(--bg); line-height:1.6; }
  main { max-width: 720px; margin: 0 auto; padding: 3rem 1.25rem; }
  h1 { font-size: 1.9rem; margin: 0 0 .25rem; }
  .tag { color: var(--muted); margin: 0 0 2rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.25rem 1.5rem; margin:1rem 0; }
  table { width:100%; border-collapse: collapse; }
  td, th { text-align:left; padding:.4rem .5rem; border-bottom:1px solid var(--line); }
  td:last-child, th:last-child { text-align:right; white-space:nowrap; }
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
  <p class="tag">Vision tools for AI agents and apps. No account. No API key. Pay per call with USDC on Base via <a href="https://x402.org">x402</a>.</p>

  <div class="card">
    <table>
      <tr><th>Tool</th><th>Does</th><th>Price</th></tr>
      <tr><td><code>POST /categorize</code></td><td>zero-shot labels + confidence (custom label sets)</td><td>$0.005</td></tr>
      <tr><td><code>POST /caption</code></td><td>one-sentence image description</td><td>$0.005</td></tr>
      <tr><td><code>POST /ocr</code></td><td>extract printed text (English)</td><td>$0.01</td></tr>
      <tr><td><code>POST /embed</code></td><td>512-dim CLIP vector for similarity search</td><td>$0.003</td></tr>
    </table>
  </div>

  <div class="card">
    <strong>Try it free</strong>
    <p>Runs the real model on a sample image.</p>
    <button id="demo-btn" onclick="runDemo()">Run demo</button>
    <div id="demo-out"></div>
  </div>

  <div class="card">
    <strong>Use it</strong>
<pre>POST /categorize        // or /caption /ocr /embed
{ "image": "https://…/photo.jpg" }

→ 402 with payment details → pay in USDC →
{ "results": [ { "label": "cat", "score": 0.91 }, … ] }</pre>
    <p>Any x402 client handles payment automatically. Machine-readable spec: <a href="/openapi.json">openapi.json</a></p>
  </div>

  <p class="foot">Free local models under the hood · buyers are never charged for failed requests · listed on x402scan &amp; 402index</p>
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
      "Vision tools for agents and apps: categorize, caption, OCR, embed. Pay per call via x402 (USDC on Base). No account, no API key.",
    endpoints: Object.fromEntries(
      Object.entries(TASK_META).map(([task, meta]) => [
        `POST /${task}`,
        { price: meta.price, network: X402_NETWORK, payment: "x402", input: { image: "https URL or data:image URI", ...(task === "categorize" ? { labels: "optional string[] (2-50)" } : {}) }, output: meta.output },
      ]),
    ),
    defaultLabels: DEFAULT_LABELS,
    payTo: AGENT_ADDRESS,
  });
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: INFERENCE, backend: INFERENCE === "local" || Boolean(upstream), ...summary() }),
);

function openapiDoc(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const paths = {};
  for (const [task, meta] of Object.entries(TASK_META)) {
    paths[`/${task}`] = {
      post: {
        summary: meta.description.split(". POST")[0],
        "x-payment": { protocol: "x402", price: meta.price, network: X402_NETWORK },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["image"],
                properties: {
                  image: { type: "string", description: "https URL or data:image URI" },
                  ...(task === "categorize"
                    ? { labels: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 50 } }
                    : {}),
                },
              },
              example: { image: "https://example.com/photo.jpg" },
            },
          },
        },
        responses: {
          200: { description: "Result", content: { "application/json": { example: meta.output } } },
          402: { description: "x402 payment required" },
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "img-categorize",
      version: "2.0.0",
      description:
        "Vision toolbox paid per-call via x402 (USDC on Base): zero-shot categorization, captioning, OCR, CLIP embeddings. No accounts or API keys.",
      contact: { email: "sixblixt@gmail.com" },
    },
    servers: [{ url: origin }],
    paths,
  };
}

app.get("/openapi.json", (req, res) => res.json(openapiDoc(req)));
app.get("/.well-known/x402", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({
    x402Version: 2,
    resources: Object.entries(TASK_META).map(([task, meta]) => ({
      url: `${origin}/${task}`,
      method: "POST",
      description: meta.description,
    })),
  });
});

const DEMO_IMAGE = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg";
let demoCache = null;
app.get("/demo", async (_req, res) => {
  try {
    demoCache ??= (await runTask("categorize", { image: DEMO_IMAGE })).results;
    res.json({
      note: "Free demo: default labels on a fixed sample image. Paid tools: /categorize /caption /ocr /embed ($0.003-$0.01 via x402).",
      sampleImage: DEMO_IMAGE,
      results: demoCache,
    });
  } catch {
    res.status(503).json({ error: "demo temporarily unavailable" });
  }
});

for (const task of Object.keys(TASK_META)) {
  app.get(`/${task}`, (req, res) => {
    res.json({ usage: `POST /${task} with JSON body {"image": "..."}`, openapi: openapiDoc(req) });
  });
  app.post(`/${task}`, async (req, res) => {
    const { image, labels } = req.body ?? {};
    if (!validImage(image)) {
      return res.status(400).json({ error: "body.image must be an https URL or data:image URI" });
    }
    try {
      const result = await runTask(task, { image, labels });
      record({ type: "sale", route: `POST /${task}`, priceUsd: TASK_META[task].priceUsd });
      res.json(result);
    } catch (err) {
      record({ type: "error", route: `POST /${task}`, message: String(err?.message ?? err) });
      res.status(err?.status ?? 422).json({
        error: err?.status === 503 ? "backend unavailable, you were not charged" : "could not process image",
      });
    }
  });
}

// --- internal endpoints (not paywalled, not in discovery docs) ---

if (INFERENCE === "local") {
  // Free inference for the trusted proxy front door; bearer token gates it.
  app.post("/infer", async (req, res) => {
    if (!INFER_TOKEN || req.headers.authorization !== `Bearer ${INFER_TOKEN}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { task, image, labels } = req.body ?? {};
    if (!validImage(image) && image !== DEMO_IMAGE) {
      return res.status(400).json({ error: "invalid image" });
    }
    try {
      res.json(await vision.runTask(task, { image, labels }));
    } catch (err) {
      res.status(err?.status ?? 422).json({ error: "could not process image" });
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
    console.log("warming up categorizer (others lazy-load)...");
    const t0 = Date.now();
    await vision.warmup();
    console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
});
