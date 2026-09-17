/**
 * Which hostname to put in a link we send OUT (email, WhatsApp, QR).
 *
 * A session cookie cannot cross two registrable domains. Guna Chess runs on
 * gunachess.com, so a reset or invite link pointing at chessguru.cc drops its
 * recipient on a host where they have no session — they sign in there, get a
 * .chessguru.cc cookie, go back to gunachess.com, and are signed out again.
 *
 * Until 2026-09-17 every such link was built from PUBLIC_URL, which on prod was
 * still `https://harinitharanjith.com` — a THIRD host. The three scopes showed
 * up in the session store exactly as you'd expect: 110 host-only,
 * 70 .chessguru.cc, 56 .harinitharanjith.com across one academy's users.
 *
 * So: send people to their own academy's domain when it has one.
 */

/** Platform default when an academy has no domain of its own. */
export function platformBase(): string {
  return (process.env.PUBLIC_URL || "https://chessguru.cc").replace(/\/+$/, "");
}

const HOSTNAME_RX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * `https://<the academy's own domain>` when one is configured and verified
 * enough to serve, else the platform default. Never throws — a link that points
 * at the platform still works, so a lookup failure must not break the send.
 */
export async function publicBaseForAcademy(db: any, academyId?: string | null): Promise<string> {
  const fallback = platformBase();
  const id = String(academyId || "").trim();
  if (!id || !db) return fallback;
  try {
    const p: any = await db.collection("academyProfiles")
      .findOne({ _id: id as any }, { projection: { customDomain: 1 } });
    const host = String(p?.customDomain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (host && HOSTNAME_RX.test(host)) return `https://${host}`;
  } catch { /* fall through to the platform host */ }
  return fallback;
}
