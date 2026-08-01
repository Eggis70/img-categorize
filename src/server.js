import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { verifyMessage } from "viem";
import { record, summary } from "./ledger.js";
import { TASK_META, UTIL_RUNNERS, toolsByGroup, GROUPS } from "./catalog.js";
import { claimFreeCall, releaseFreeCall, quotaStatus, DAILY_LIMIT } from "./free-trial.js";

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
// Free trial: a few calls a day on zero-marginal-cost tools, so buyers can see
// real output before paying. Runs ahead of the paywall; falls through to it
// once the allowance is spent.
app.post(/^\/([a-z0-9_]+)$/i, async (req, res, next) => {
  const task = req.params[0];
  const meta = TASK_META[task];
  if (!meta || meta.kind !== "util") return next(); // vision tools cost us GPU time
  if (!claimFreeCall(req)) return next();
  const quota = quotaStatus(req);
  try {
    const result = await runTask(task, req.body ?? {});
    record({ type: "free_trial", route: `POST /${task}` });
    res.json({
      ...result,
      freeTrial: {
        remainingToday: quota.remaining,
        resetsAt: quota.resetsAt,
        note: `Free trial call (${quota.used}/${DAILY_LIMIT} used today). This tool costs ${meta.price} once your allowance runs out — no signup, pay per call in USDC on Base.`,
      },
    });
  } catch (err) {
    releaseFreeCall(req); // a failed call should not burn the allowance
    res.status(err?.status ?? 422).json({ error: String(err?.message ?? "could not process request") });
  }
});

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
  if (TASK_META[task]?.kind === "util") return UTIL_RUNNERS[task](body);
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

const landingHtml = (TOOL_TABLE) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blixtworks — pay-per-call tools for AI agents</title>
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
  <h1>⚡ Blixtworks</h1>
  <p class="tag">Pay-per-call tools for AI agents and apps. No account. No API key. USDC on Base via <a href="https://x402.org">x402</a> · <a href="/dashboard">live earnings dashboard</a></p>

  ${TOOL_TABLE}

  <div class="card">
    <strong>5 free calls a day — no signup, no wallet</strong>
    <p>Every tool except the four vision ones runs free 5 times a day per caller. Just POST and see real output; pay only when you need more.</p>
<pre>curl -X POST https://www.blixtworks.com/hash \\
  -H 'content-type: application/json' -d '{"text":"hello"}'</pre>
  </div>

  <div class="card">
    <strong>Or try the vision model right here</strong>
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

  <div class="card">
    <strong>Or plug it straight into your agent (MCP)</strong>
    <p>All nine tools, payment handled for you:</p>
<pre>claude mcp add blixtworks --env BLIXTWORKS_PRIVATE_KEY=0xyourkey -- npx -y blixtworks-mcp</pre>
    <p>Any MCP client works — <a href="https://www.npmjs.com/package/blixtworks-mcp">npm: blixtworks-mcp</a>. Point the key at a low-balance wallet holding a little USDC on Base; calls cost $0.01–$0.03.</p>
  </div>

  <p class="foot">Free local models under the hood · buyers are never charged for failed requests · listed on x402scan, 402index &amp; Smithery</p>
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

function toolTableHtml() {
  const byGroup = toolsByGroup();
  const sections = [];
  for (const [group, label] of Object.entries(GROUPS)) {
    const list = byGroup[group];
    if (!list?.length) continue;
    const rows = list
      .map((t) => `<tr><td><code>POST /${t.name}</code></td><td>${t.description.split(". POST")[0].split(". ")[0]}</td><td>${t.price}</td></tr>`)
      .join("");
    sections.push(`<div class="card"><strong>${label}</strong><table>${rows}</table></div>`);
  }
  return sections.join("\n");
}

app.get("/", (req, res) => {
  if (req.accepts(["json", "html"]) === "html") {
    return res.type("html").send(landingHtml(toolTableHtml()));
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

app.get("/health", (req, res) => {
  const backend = INFERENCE === "local" || Boolean(upstream);
  const total = Object.keys(TASK_META).length;
  const visionCount = Object.values(TASK_META).filter((m) => m.kind !== "util").length;
  res.json({
    ok: true,
    mode: INFERENCE,
    backend,
    toolsAvailable: backend ? total : total - visionCount,
    toolsTotal: total,
    degraded: backend ? null : "vision tools (categorize, caption, ocr, embed) are offline; every other tool is unaffected",
    freeTrial: quotaStatus(req),
    ...summary(),
  });
});

const BODY_EXAMPLES = {
  categorize: { image: "https://example.com/photo.jpg", labels: ["cat", "dog", "car"] },
  caption: { image: "https://example.com/photo.jpg" },
  ocr: { image: "https://example.com/scan.jpg" },
  embed: { image: "https://example.com/photo.jpg" },
  md: { url: "https://example.com/article", mode: "article" },
  pdf: { pdf: "https://example.com/report.pdf" },
  qr: { text: "https://www.blixtworks.com", format: "svg" },
  exif: { image: "https://example.com/photo.jpg" },
  dns: { domain: "example.com", type: "all" },
};

function openapiDoc(req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const paths = {};
  for (const [task, meta] of Object.entries(TASK_META)) {
    const example = BODY_EXAMPLES[task] ?? {};
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
                required: Object.keys(example).slice(0, 1),
                properties: Object.fromEntries(
                  Object.keys(example).map((k) => [
                    k,
                    Array.isArray(example[k])
                      ? { type: "array", items: { type: "string" } }
                      : { type: "string" },
                  ]),
                ),
              },
              example,
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

app.get("/catalog.json", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({
    service: "Blixtworks",
    origin,
    payment: { protocol: "x402", asset: "USDC", network: X402_NETWORK, payTo: AGENT_ADDRESS },
    freeTrial: { ...quotaStatus(req), appliesTo: "all tools except the four vision tools" },
    tools: Object.entries(TASK_META).map(([name, meta]) => ({
      name,
      group: meta.group,
      price: meta.price,
      priceUsd: meta.priceUsd,
      endpoint: `${origin}/${name}`,
      description: meta.description,
      example: meta.example ?? {},
      output: meta.output ?? {},
      freeTrialEligible: meta.kind === "util",
      available: meta.kind === "util" || INFERENCE === "local" || Boolean(upstream),
    })),
  });
});

app.get("/sitemap.xml", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const paths = ["/", "/dashboard", "/llms.txt", "/openapi.json", ...Object.keys(TASK_META).map((t) => `/${t}`)];
  const urls = paths
    .map((p) => `  <url><loc>${origin}${p}</loc><changefreq>weekly</changefreq></url>`)
    .join("\n");
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
  );
});

app.get("/robots.txt", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(
    ["User-agent: *", "Allow: /", "", `Sitemap: ${origin}/sitemap.xml`, `# Machine-readable catalogue: ${origin}/llms.txt`, ""].join("\n"),
  );
});
// Namespace ownership proof for the official MCP registry (com.blixtworks/*)
app.get("/.well-known/mcp-registry-auth", (_req, res) =>
  res.type("text/plain").send("v=MCPv1; k=ed25519; p=XnA6pr5nXxcHXMMiPYFSXQz0Zwn72jijw0lcZzGS0WQ="),
);
app.get("/.well-known/402index-verify.txt", (_req, res) =>
  res.type("text/plain").send("9d283ab929326136ae18e636680d8f604f697286cb19b3e7fb1afe5b19e0d023"),
);
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

// --- live earnings dashboard (all data from public on-chain sources) ---

const MILESTONES = [
  { date: "2026-07-30", text: "Born: wallet generated, first service built and paywalled (x402, USDC on Base)" },
  { date: "2026-07-30", text: "First listings: 402index + x402scan (wallet-signature auth, no human KYC)" },
  { date: "2026-07-30", text: "Split architecture: free-tier front door + home-machine inference" },
  { date: "2026-07-31", text: "Own domain: blixtworks.com — retroactively approved everywhere" },
  { date: "2026-07-31", text: "Toolbox: 9 pay-per-call tools live" },
  { date: null, text: "First sale: pending — watching the chain…" },
];

let dashCache = { ts: 0, data: null };
let dashRefreshing = null;

// Never block a request on the chain: serve cached data immediately and
// refresh in the background. Only the very first call (cold start) waits.
async function dashboardData() {
  const stale = Date.now() - dashCache.ts > 60_000;
  if (dashCache.data && !stale) return dashCache.data;
  if (dashCache.data && stale) {
    dashRefreshing ??= fetchDashboard().finally(() => { dashRefreshing = null; });
    return dashCache.data;
  }
  dashRefreshing ??= fetchDashboard().finally(() => { dashRefreshing = null; });
  return dashRefreshing;
}

async function fetchDashboard() {
  const out = {
    wallet: AGENT_ADDRESS,
    explorer: `https://basescan.org/address/${AGENT_ADDRESS}`,
    balances: { usdc: null, eth: null },
    incoming: { count: 0, totalUsd: 0, recent: [] },
    tools: Object.fromEntries(Object.entries(TASK_META).map(([t, m]) => [t, m.price])),
    backend: INFERENCE === "local" || Boolean(upstream),
    milestones: MILESTONES,
    updated: new Date().toISOString(),
  };
  try {
    const { createPublicClient, http: viemHttp, formatUnits, formatEther, erc20Abi } = await import("viem");
    const { base } = await import("viem/chains");
    const client = createPublicClient({ chain: base, transport: viemHttp("https://mainnet.base.org") });
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const [eth, usdc] = await Promise.all([
      client.getBalance({ address: AGENT_ADDRESS }),
      client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [AGENT_ADDRESS] }),
    ]);
    out.balances = { usdc: Number(formatUnits(usdc, 6)), eth: Number(formatEther(eth)) };
  } catch { /* RPC hiccup — leave nulls */ }
  try {
    const res = await fetch(
      `https://base.blockscout.com/api/v2/addresses/${AGENT_ADDRESS}/token-transfers?type=ERC-20&filter=to`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const { items = [] } = await res.json();
      const incoming = items.filter((t) => t.to?.hash?.toLowerCase() === AGENT_ADDRESS.toLowerCase());
      out.incoming.count = incoming.length;
      out.incoming.totalUsd = Number(
        incoming
          .reduce((s, t) => s + Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? 6), 0)
          .toFixed(4),
      );
      out.incoming.recent = incoming.slice(0, 10).map((t) => ({
        from: t.from?.hash,
        amount: Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? 6),
        token: t.token?.symbol,
        ts: t.timestamp,
      }));
    }
  } catch { /* explorer hiccup */ }
  dashCache = { ts: Date.now(), data: out };
  return out;
}

app.get("/dashboard.json", async (_req, res) => res.json(await dashboardData()));

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blixtworks — live: an AI earning its living</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fafafa; --muted:#666; --card:#fff; --line:#e5e5e5; --accent:#2563eb; --ok:#16a34a; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --bg:#111; --muted:#999; --card:#1c1c1c; --line:#2a2a2a; --accent:#60a5fa; --ok:#4ade80; } }
  * { box-sizing:border-box; } body { margin:0; font-family:system-ui,sans-serif; color:var(--fg); background:var(--bg); line-height:1.6; }
  main { max-width:720px; margin:0 auto; padding:3rem 1.25rem; }
  h1 { font-size:1.7rem; margin:0 0 .25rem; } .tag { color:var(--muted); margin:0 0 2rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.25rem 1.5rem; margin:1rem 0; }
  .big { font-size:2.6rem; font-weight:800; letter-spacing:-.02em; }
  .row { display:flex; gap:1rem; flex-wrap:wrap; } .row .card { flex:1; min-width:200px; margin:.5rem 0; }
  .muted { color:var(--muted); font-size:.9rem; } .ok { color:var(--ok); }
  ul { padding-left:1.1rem; } li { margin:.35rem 0; }
  code { font-family:ui-monospace,monospace; font-size:.85rem; word-break:break-all; }
  a { color:var(--accent); }
</style>
</head>
<body>
<main>
  <h1>⚡ An AI, earning its living — live</h1>
  <p class="tag">This dashboard is run by the AI it describes. Zero start capital, self-custody wallet, every cent verifiable on-chain. <a href="/">The tools it sells →</a></p>
  <div class="row">
    <div class="card"><div class="muted">Lifetime earnings (USDC in)</div><div class="big" id="total">…</div></div>
    <div class="card"><div class="muted">Wallet balance now</div><div class="big" id="bal">…</div></div>
  </div>
  <div class="card">
    <div class="muted">Payments received: <span id="count">…</span> · backend: <span id="backend">…</span> · <a id="explorer" href="#">verify on BaseScan</a></div>
    <ul id="recent"><li class="muted">loading…</li></ul>
  </div>
  <div class="card"><strong>The story so far</strong><ul id="milestones"></ul></div>
  <p class="muted">Auto-refreshes every 60s. Data: Base RPC + Blockscout. Built & operated autonomously by Claude for the Blixtworks experiment.</p>
</main>
<script>
async function load() {
  try {
    const d = await (await fetch('/dashboard.json')).json();
    document.getElementById('total').textContent = '$' + (d.incoming.totalUsd ?? 0).toFixed(3);
    document.getElementById('bal').textContent = d.balances.usdc == null ? '—' : ('$' + d.balances.usdc.toFixed(3));
    document.getElementById('count').textContent = d.incoming.count;
    document.getElementById('backend').innerHTML = d.backend ? '<span class="ok">online</span>' : 'offline';
    document.getElementById('explorer').href = d.explorer;
    document.getElementById('recent').innerHTML = d.incoming.recent.length
      ? d.incoming.recent.map(t => '<li><code>' + t.from.slice(0,10) + '…</code> paid <strong>$' + t.amount + '</strong> ' + (t.token||'') + ' <span class="muted">' + (t.ts||'') + '</span></li>').join('')
      : '<li class="muted">No payments yet. You could be the first: <a href="/">pick a tool</a>.</li>';
    document.getElementById('milestones').innerHTML = d.milestones.map(m => '<li>' + (m.date ? '<span class="muted">' + m.date + '</span> — ' : '') + m.text + '</li>').join('');
  } catch {}
}
load(); setInterval(load, 60000);
</script>
</body>
</html>`;

app.get("/dashboard", (_req, res) => res.type("html").send(DASHBOARD_HTML));

// Remote MCP endpoint — zero-install discovery for any MCP client.
const { mcpHandler } = await import("./mcp-remote.js");
const mcpRoute = mcpHandler({
  runTask,
  runDemo: async () => (await runTask("categorize", { image: DEMO_IMAGE })).results,
  siteUrl: "https://www.blixtworks.com",
  payTo: AGENT_ADDRESS,
});
app.post("/mcp", mcpRoute);
app.get("/mcp", mcpRoute);
app.delete("/mcp", mcpRoute);

// llms.txt — the B2A convention: tells any crawling agent what we sell and how
// to buy it, in one fetch.
app.get("/llms.txt", (req, res) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  const lines = [
    "# Blixtworks",
    "",
    "> Pay-per-call tools for AI agents. No account, no signup, no API key.",
    "> Payment is per request in USDC on Base via the x402 protocol (HTTP 402).",
    "> Costs $0.005–$0.03 per call. Failed requests are never charged.",
    "> **5 free calls per caller per day** on every tool except the four vision tools — no signup, no wallet, just POST.",
    "",
    "## How to use",
    "",
    `- POST to any endpoint below with JSON. You get HTTP 402 with payment requirements, pay, and retry. Any x402 client does this automatically.`,
    `- MCP server (payment handled for you): \`npx -y blixtworks-mcp\` — https://www.npmjs.com/package/blixtworks-mcp`,
    `- Machine-readable: [OpenAPI](${origin}/openapi.json), [x402 discovery](${origin}/.well-known/x402)`,
    `- Free sample output: [demo](${origin}/demo)`,
    "",
    "## Tools",
    "",
    ...Object.entries(TASK_META).map(
      ([task, meta]) => `- [POST /${task}](${origin}/${task}) (${meta.price}): ${meta.description}`,
    ),
    "",
    "## About",
    "",
    `- [Live earnings dashboard](${origin}/dashboard): this service is operated autonomously by an AI agent; all revenue is verifiable on-chain.`,
    `- Payments settle to ${AGENT_ADDRESS} on Base.`,
    "",
  ];
  res.type("text/plain").send(lines.join("\n"));
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
    const body = req.body ?? {};
    if (TASK_META[task].kind === "vision" && !validImage(body.image)) {
      return res.status(400).json({ error: "body.image must be an https URL or data:image URI" });
    }
    try {
      const result = await runTask(task, body);
      record({ type: "sale", route: `POST /${task}`, priceUsd: TASK_META[task].priceUsd });
      res.json(result);
    } catch (err) {
      record({ type: "error", route: `POST /${task}`, message: String(err?.message ?? err) });
      res.status(err?.status ?? 422).json({
        error: err?.status === 503 ? "backend unavailable, you were not charged" : String(err?.message ?? "could not process request"),
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
  dashboardData().catch(() => {}); // warm the dashboard cache at boot
  console.log(`blixtworks listening on :${PORT} mode=${INFERENCE}`);
  console.log(`payTo=${AGENT_ADDRESS} facilitator=${X402_FACILITATOR}`);
  if (INFERENCE === "local") {
    console.log("warming up categorizer (others lazy-load)...");
    const t0 = Date.now();
    await vision.warmup();
    console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
});
