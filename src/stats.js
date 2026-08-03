// Traffic counters.
//
// The front door runs on an ephemeral filesystem, so its sales ledger vanishes
// on every restart. Without this we cannot tell "nobody has found us" apart
// from "plenty of visitors, none converting" — two problems with opposite
// fixes. Counters live in memory and the worker polls them, building a durable
// history on the home machine.

const counts = {
  startedAt: new Date().toISOString(),
  requests: 0,
  freeTrialCalls: 0,
  paidCalls: 0,
  paywallHits: 0, // 402s served — someone wanted a tool but did not pay
  errors: 0,
  mcpSessions: 0,
  mcpToolCalls: 0,
  discoveryHits: 0, // catalogue, openapi, llms.txt, well-known — crawlers and agents
  byTool: {},
  byUserAgent: {},
  callers: new Set(),
};

const bump = (obj, key) => {
  if (!key) return;
  obj[key] = (obj[key] ?? 0) + 1;
};

export function recordRequest({ tool, kind, userAgent, caller }) {
  counts.requests += 1;
  if (tool) bump(counts.byTool, tool);
  if (caller) counts.callers.add(caller);
  if (userAgent) {
    // Group by product token so the map stays small and readable.
    bump(counts.byUserAgent, String(userAgent).split("/")[0].slice(0, 40));
  }
  switch (kind) {
    case "free": counts.freeTrialCalls += 1; break;
    case "paid": counts.paidCalls += 1; break;
    case "paywall": counts.paywallHits += 1; break;
    case "error": counts.errors += 1; break;
    case "mcp-session": counts.mcpSessions += 1; break;
    case "mcp-tool": counts.mcpToolCalls += 1; break;
    case "discovery": counts.discoveryHits += 1; break;
    default: break;
  }
}

export function snapshot() {
  const topTools = Object.entries(counts.byTool).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return {
    startedAt: counts.startedAt,
    uptimeMinutes: Math.round((Date.now() - new Date(counts.startedAt).getTime()) / 60000),
    requests: counts.requests,
    freeTrialCalls: counts.freeTrialCalls,
    paidCalls: counts.paidCalls,
    paywallHits: counts.paywallHits,
    errors: counts.errors,
    mcpSessions: counts.mcpSessions,
    mcpToolCalls: counts.mcpToolCalls,
    discoveryHits: counts.discoveryHits,
    uniqueCallers: counts.callers.size,
    topTools: Object.fromEntries(topTools),
    userAgents: counts.byUserAgent,
  };
}
