// Walks the whole path a real buyer takes, against the live site: discovery
// documents, free trial, paywall, remote MCP handshake and payment rejection.
// Catches the failures that only appear in production.
const SITE = process.env.SITE ?? "https://www.blixtworks.com";
const checks = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, ok: true, detail });
    console.log(`✓ ${name.padEnd(38)} ${detail ?? ""}`);
  } catch (err) {
    checks.push({ name, ok: false, detail: String(err?.message ?? err) });
    console.log(`✗ ${name.padEnd(38)} ${String(err?.message ?? err).slice(0, 90)}`);
  }
}

const get = async (path, init) => {
  const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(60000), ...init });
  return res;
};

const mcp = async (body) => {
  const res = await get("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return line ? JSON.parse(line.slice(6)) : JSON.parse(text || "{}");
};

await check("landing page renders", async () => {
  const res = await get("/", { headers: { accept: "text/html" } });
  const html = await res.text();
  if (!html.startsWith("<!doctype html>")) throw new Error("not HTML");
  if (!html.includes("free calls a day")) throw new Error("free trial not advertised");
  return `${html.length} bytes`;
});

await check("catalogue lists tools", async () => {
  const data = await (await get("/catalog.json")).json();
  if (!data.tools?.length) throw new Error("no tools");
  return `${data.tools.length} tools, ${data.tools.filter((t) => t.freeTrialEligible).length} free-trial eligible`;
});

await check("openapi.json is valid", async () => {
  const doc = await (await get("/openapi.json")).json();
  const paths = Object.keys(doc.paths ?? {});
  if (!paths.length) throw new Error("no paths");
  return `${paths.length} paths`;
});

await check("x402 discovery document", async () => {
  const doc = await (await get("/.well-known/x402")).json();
  if (!doc.resources?.length) throw new Error("no resources");
  return `${doc.resources.length} resources`;
});

await check("llms.txt describes the service", async () => {
  const text = await (await get("/llms.txt")).text();
  if (!text.includes("Blixtworks")) throw new Error("missing branding");
  return `${text.split("\n").length} lines`;
});

await check("sitemap + robots", async () => {
  const [sm, rb] = await Promise.all([get("/sitemap.xml"), get("/robots.txt")]);
  if (!sm.ok || !rb.ok) throw new Error("missing");
  return "both served";
});

await check("health reports availability", async () => {
  const h = await (await get("/health")).json();
  if (typeof h.toolsAvailable !== "number") throw new Error("no availability field");
  return `${h.toolsAvailable}/${h.toolsTotal} available, backend ${h.backend}`;
});

await check("free trial serves a real result", async () => {
  const res = await get("/dns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "example.com", type: "A" }),
  });
  if (res.status === 402) return "allowance already spent today (paywall active)";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.records && !body.domain) throw new Error("no result payload");
  return `free call ok, ${body.freeTrial?.remainingToday ?? "?"} left today`;
});

await check("paywall demands payment when spent", async () => {
  // Burn through the allowance, then confirm the paywall engages.
  let status = 200;
  for (let i = 0; i < 8 && status === 200; i++) {
    status = (await get("/uuid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    })).status;
  }
  if (status !== 402) throw new Error(`expected 402, got ${status}`);
  return "402 with payment requirements";
});

await check("402 carries valid requirements", async () => {
  const res = await get("/ocr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: "x" }),
  });
  const header = res.headers.get("payment-required");
  if (!header) throw new Error("no PAYMENT-REQUIRED header");
  const req = JSON.parse(Buffer.from(header, "base64").toString());
  const accept = req.accepts?.[0];
  if (!accept?.payTo || !accept?.amount) throw new Error("incomplete requirements");
  return `$${Number(accept.amount) / 1e6} to ${accept.payTo.slice(0, 10)}…`;
});

await check("remote MCP handshake", async () => {
  const init = await mcp({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "buyer-journey", version: "1" } },
  });
  if (!init.result?.serverInfo) throw new Error("no serverInfo");
  return `${init.result.serverInfo.name} v${init.result.serverInfo.version}`;
});

await check("remote MCP lists tools", async () => {
  const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = list.result?.tools ?? [];
  if (tools.length < 10) throw new Error(`only ${tools.length} tools`);
  return `${tools.length} tools exposed`;
});

await check("remote MCP rejects bogus payment", async () => {
  const call = await mcp({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "hash", arguments: { text: "x", paymentTx: `0x${"1".repeat(64)}` } },
  });
  const text = call.result?.content?.[0]?.text ?? "";
  if (!call.result?.isError) throw new Error("accepted a fake payment");
  return text.split("\n")[0].slice(0, 50);
});

await check("remote MCP free tool works", async () => {
  const call = await mcp({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "list_tools", arguments: { group: "chain" } },
  });
  const data = JSON.parse(call.result?.content?.[0]?.text ?? "{}");
  if (!data.toolCount) throw new Error("no catalogue returned");
  return `${data.toolCount} chain tools`;
});

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
