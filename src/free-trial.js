// Free trial quota.
//
// Nobody buys a tool they have never seen work. Deterministic tools cost us
// nothing per call, so a small daily allowance per caller is the cheapest
// possible conversion mechanism: try it for real, then pay.
//
// Counters live in memory and reset daily. A restart hands out a few extra free
// calls, which is a giveaway, not a loss — so no persistence is warranted.

const DAILY_LIMIT = 5;
const buckets = new Map(); // key -> { used: number, resetAt: number }

function dayEnd() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function bucketFor(key) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (existing && existing.resetAt > now) return existing;
  const fresh = { used: 0, resetAt: dayEnd() };
  buckets.set(key, fresh);
  return fresh;
}

// Keep the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60 * 60 * 1000).unref?.();

export function callerKey(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (typeof fwd === "string" ? fwd.split(",")[0].trim() : null) || req.ip || "unknown";
  return ip;
}

export function quotaStatus(req) {
  const b = bucketFor(callerKey(req));
  return { limit: DAILY_LIMIT, used: b.used, remaining: Math.max(0, DAILY_LIMIT - b.used), resetsAt: new Date(b.resetAt).toISOString() };
}

/**
 * Claim one free call. Returns false when the allowance is spent.
 * Only ever called for tools whose marginal cost to us is zero.
 */
export function claimFreeCall(req) {
  const b = bucketFor(callerKey(req));
  if (b.used >= DAILY_LIMIT) return false;
  b.used += 1;
  return true;
}

export function releaseFreeCall(req) {
  const b = bucketFor(callerKey(req));
  if (b.used > 0) b.used -= 1;
}

export { DAILY_LIMIT };
