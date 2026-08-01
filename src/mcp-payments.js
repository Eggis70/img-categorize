// Payment verification for the remote MCP endpoint.
//
// Buyers pay from their own wallet and hand us only a transaction hash — we
// never ask for a private key. Every hash is verified against Base: it must be
// a successful USDC transfer to our address, recent, and not already spent.
//
// Credit is held in memory. That is a deliberate trade-off on a free-tier host
// with no persistent disk, and it is disclosed to buyers: pay close to what the
// call costs, because leftover credit does not survive a restart. The freshness
// window doubles as replay protection — after a restart, any hash old enough to
// be missing from the spent set is also too old to accept.
import { createPublicClient, http, getAddress, parseAbiItem, decodeEventLog } from "viem";
import { base } from "viem/chains";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour: payment freshness + replay bound
const CREDIT_TTL_MS = 60 * 60 * 1000;

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

const spentTxs = new Map(); // txHash -> expiry timestamp
const credit = new Map(); // payer address -> { micros: bigint, expires: number }

function sweep() {
  const now = Date.now();
  for (const [hash, exp] of spentTxs) if (exp < now) spentTxs.delete(hash);
  for (const [addr, c] of credit) if (c.expires < now) credit.delete(addr);
}
setInterval(sweep, 10 * 60 * 1000).unref?.();

export const toMicros = (usd) => BigInt(Math.round(usd * 1e6));
export const fromMicros = (micros) => Number(micros) / 1e6;

export function creditFor(address) {
  sweep();
  const key = address?.toLowerCase();
  const c = key && credit.get(key);
  return c && c.expires > Date.now() ? c.micros : 0n;
}

function addCredit(address, micros) {
  const key = address.toLowerCase();
  const existing = creditFor(address);
  credit.set(key, { micros: existing + micros, expires: Date.now() + CREDIT_TTL_MS });
}

/** Return credit after a charged call failed — buyers never pay for errors. */
export function refundCredit(address, priceUsd) {
  addCredit(address, toMicros(priceUsd));
}

function spendCredit(address, micros) {
  const key = address.toLowerCase();
  const existing = creditFor(address);
  if (existing < micros) return false;
  credit.set(key, { micros: existing - micros, expires: Date.now() + CREDIT_TTL_MS });
  return true;
}

/**
 * Verify a USDC payment to our wallet and bank it as credit for the payer.
 * @returns {Promise<{ok: true, payer: string, paid: bigint} | {ok: false, error: string}>}
 */
export async function redeemPayment(txHash, payTo) {
  if (typeof txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(txHash)) {
    return { ok: false, error: "paymentTx must be a 0x transaction hash" };
  }
  sweep();
  if (spentTxs.has(txHash.toLowerCase())) {
    return { ok: false, error: "this transaction has already been used" };
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, error: "transaction not found on Base yet — wait for it to confirm and retry" };
  }
  if (receipt.status !== "success") return { ok: false, error: "transaction reverted on chain" };

  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  const ageMs = block ? Date.now() - Number(block.timestamp) * 1000 : 0;
  if (ageMs > MAX_AGE_MS) {
    return { ok: false, error: `payment is too old (${Math.round(ageMs / 60000)} min) — send a fresh one` };
  }

  const target = getAddress(payTo);
  let received = 0n;
  let payer = null;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== getAddress(USDC)) continue;
    try {
      const { args } = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics });
      if (getAddress(args.to) === target) {
        received += args.value;
        payer ??= getAddress(args.from);
      }
    } catch { /* not a Transfer log */ }
  }

  if (received === 0n || !payer) {
    return { ok: false, error: "no USDC transfer to the Blixtworks address found in that transaction" };
  }

  spentTxs.set(txHash.toLowerCase(), Date.now() + MAX_AGE_MS * 2);
  addCredit(payer, received);
  return { ok: true, payer, paid: received };
}

/**
 * Charge a tool call against credit, optionally redeeming a payment first.
 * @returns {Promise<{ok: true, payer: string, remaining: bigint} | {ok: false, error: string, needed: number}>}
 */
export async function chargeCall({ paymentTx, payerHint, priceUsd, payTo }) {
  const price = toMicros(priceUsd);
  let payer = payerHint ? tryAddress(payerHint) : null;

  if (paymentTx) {
    const redeemed = await redeemPayment(paymentTx, payTo);
    if (!redeemed.ok) return { ok: false, error: redeemed.error, needed: priceUsd };
    payer = redeemed.payer;
  }

  if (!payer) return { ok: false, error: "no payment supplied", needed: priceUsd };
  if (!spendCredit(payer, price)) {
    return {
      ok: false,
      error: `insufficient credit: $${fromMicros(creditFor(payer)).toFixed(4)} available, $${priceUsd} needed`,
      needed: priceUsd,
    };
  }
  return { ok: true, payer, remaining: creditFor(payer) };
}

function tryAddress(a) {
  try {
    return getAddress(a);
  } catch {
    return null;
  }
}
