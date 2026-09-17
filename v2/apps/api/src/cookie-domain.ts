/**
 * Session cookie scope + lifetime policy.
 *
 * Why this file exists: a cookie cannot cross two registrable domains, and we
 * serve the same users on three hosts — chessguru.cc, an academy's own domain
 * (gunachess.com), and the legacy harinitharanjith.com. Whatever scope we hand
 * out has to be the WIDEST one that host can legally set, or people get logged
 * out every time a link lands them somewhere else.
 *
 * Measured 2026-09-17 on Guna Chess: 63 users were holding 286 separate
 * sessions, one student alone had 38, and the scopes issued split
 * 110 host-only / 70 .chessguru.cc / 56 .harinitharanjith.com.
 */

/** Never expires. Only POST /auth/logout ends a session (owner ask 2026-09-17).
 *  Ten years is "never" in cookie terms — Chrome caps cookie lifetime at 400
 *  days anyway (RFC 6265bis), so the real ceiling is the browser's, and `rolling`
 *  slides it forward on every request so an active user never reaches it. */
export const SESSION_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Multi-label public suffixes. A naive "last two labels" returns `co.in` for
 * shriguruchessacademy.co.in — a PUBLIC SUFFIX, which every browser rejects
 * outright (it would let any .co.in site read their cookie). The Set-Cookie is
 * then dropped and that academy is logged out on literally every request, which
 * is worse than the host-only cookie this replaces. Keep this list ahead of the
 * domains we actually sell into; it is not a substitute for the full PSL.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in", "res.in",
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "net.nz", "org.nz", "ac.nz", "school.nz",
  "com.sg", "com.my", "com.ph", "com.hk", "com.tw", "com.cn", "net.cn", "org.cn",
  "com.br", "com.mx", "com.ar", "com.co", "com.pk", "com.bd", "com.np", "com.lk",
  "co.za", "co.ke", "co.th", "co.id", "co.kr",
  "co.jp", "or.jp", "ne.jp", "ac.jp",
  "com.tr", "com.ua", "com.ru", "com.sa", "com.eg", "com.ng",
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * eTLD+1 for a hostname, or null when a cookie must stay host-only
 * (an IP, `localhost`, a single label, or a bare public suffix).
 */
export function registrableDomain(host: string): string | null {
  const h = String(host || "").toLowerCase().trim().replace(/\.$/, "").split(":")[0];
  if (!h || h === "localhost" || IPV4.test(h) || h.includes("[") || h.includes("_")) return null;
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return null;                       // "localhost", "intranet"
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    if (parts.length < 3) return null;                     // the bare suffix itself
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * The `Domain=` to put on the session cookie for a request arriving at `host`.
 * `undefined` means host-only, which is correct only when no wider scope is legal.
 *
 * This deliberately subsumes the old special cases: chessguru.cc and
 * harinitharanjith.com are just registrable domains, so `admin.chessguru.cc`
 * and `chessguru.cc` keep sharing one session exactly as before, and every
 * tenant domain now gets the same treatment instead of falling to host-only.
 */
export function cookieDomainForHost(host: string): string | undefined {
  const reg = registrableDomain(host);
  return reg ? `.${reg}` : undefined;
}
