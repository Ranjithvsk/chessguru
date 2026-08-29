// Razorpay wrapper — order-create + webhook signature verify.
//
// We deliberately don't use the razorpay npm SDK; the surface we need is tiny
// (two REST calls + one HMAC verify) and fetch + node:crypto have zero
// footprint. Fewer deps to bump / audit.
//
// Config lives in env, read at call time so a pm2 restart with rotated keys
// picks up without a rebuild:
//   RAZORPAY_KEY_ID              (rzp_test_* or rzp_live_*)
//   RAZORPAY_KEY_SECRET
//   RAZORPAY_WEBHOOK_SECRET      (set once in RZP dashboard → Webhooks)
//
// isConfigured() returns false when any of these is unset — the parent portal
// UI degrades gracefully to "online payment coming soon; please contact the
// academy" instead of showing a broken checkout.

import crypto from "node:crypto";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export function readRazorpayCredentials(): RazorpayCredentials | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

export function isConfigured(): boolean {
  return readRazorpayCredentials() !== null;
}

/** POST https://api.razorpay.com/v1/orders — creates a new payment order. */
export async function createOrder(input: {
  amountPaise: number;
  receipt: string;                       // ≤ 40 chars — we pass invoiceIds hash
  notes: Record<string, string>;         // stored on order, echoed in webhook payload
}): Promise<{ id: string; amount: number; currency: string; receipt: string }> {
  const creds = readRazorpayCredentials();
  if (!creds) throw new Error("Razorpay is not configured (env keys missing).");
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const body = {
    amount: input.amountPaise,           // integer paise
    currency: "INR",
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
  };
  const r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* raw */ }
  if (!r.ok) {
    const msg = (parsed && typeof parsed === "object" && "error" in parsed)
      ? JSON.stringify((parsed as { error: unknown }).error).slice(0, 400)
      : `Razorpay order create failed (${r.status})`;
    throw new Error(msg);
  }
  const order = parsed as { id: string; amount: number; currency: string; receipt: string };
  if (!order.id) throw new Error("Razorpay returned an order without an id.");
  return order;
}

/** Verify the X-Razorpay-Signature header against the raw request body.
 *  Returns true only when the sha256 HMAC (webhook_secret, rawBody) matches
 *  the header. Constant-time comparison via crypto.timingSafeEqual. */
export function verifyWebhookSignature(rawBody: string | Buffer, headerSignature: string): boolean {
  const creds = readRazorpayCredentials();
  if (!creds) return false;
  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", creds.webhookSecret).update(bodyStr).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from((headerSignature || "").trim(), "hex");
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

/** After the checkout modal closes with a successful payment, Razorpay also
 *  posts a payment.captured webhook (typically within seconds). This helper
 *  verifies the "handshake" fields returned to the client so we can flip the
 *  UI to Success optimistically without waiting for the webhook. */
export function verifyPaymentHandshake(input: { orderId: string; paymentId: string; signature: string }): boolean {
  const creds = readRazorpayCredentials();
  if (!creds) return false;
  const expected = crypto.createHmac("sha256", creds.keySecret).update(`${input.orderId}|${input.paymentId}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from((input.signature || "").trim(), "hex");
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

/** Deterministic portal token: HMAC-sha256(salt, `${academyId}:${guardianUserId}`)
 *  → first 40 hex chars. Salt is a fixed server-side secret (PORTAL_TOKEN_SALT)
 *  so the token stays stable across restarts. Rotating the salt invalidates
 *  every issued link — see the /rotate action (deferred to W4c).
 *
 *  Anyone who obtains the URL can pay bills for that guardian's students —
 *  that's the whole point of a magic-link portal. The token doesn't reveal
 *  guardianUserId; even if the DB leaks read-only, an attacker can't
 *  reverse-engineer more links.
 */
export function portalToken(academyId: string, guardianUserId: string): string {
  const salt = process.env.PORTAL_TOKEN_SALT?.trim();
  if (!salt) throw new Error("PORTAL_TOKEN_SALT env is not set — refusing to mint an insecure portal token.");
  return crypto.createHmac("sha256", salt).update(`${academyId}:${guardianUserId}`).digest("hex").slice(0, 40);
}

export function verifyPortalToken(token: string, academyId: string, guardianUserId: string): boolean {
  try {
    const expected = portalToken(academyId, guardianUserId);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from((token || "").trim(), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

/** Build the full public portal URL for a guardian. Used by the "send portal
 *  link" admin action + email templates. */
export function portalUrl(academyId: string, guardianUserId: string): string {
  const origin = process.env.CHESSGURU_PUBLIC_ORIGIN ?? "https://chessguru.cc";
  const t = portalToken(academyId, guardianUserId);
  // The URL carries guardianUserId in the query so the token verify is
  // deterministic without a lookup table. Anyone with the URL can pay for
  // this guardian's students (intentional — magic link).
  return `${origin}/pay/${t}?g=${encodeURIComponent(guardianUserId)}&a=${encodeURIComponent(academyId)}`;
}
