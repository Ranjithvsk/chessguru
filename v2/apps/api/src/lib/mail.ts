// Delivers mail through our own self-hosted dw-otp service (nodemailer +
// DKIM, direct-to-recipient MX, no third-party relay). dw-otp lives on
// Mumbai; a systemd SSH tunnel (dwotp-tunnel.service) forwards France's
// 127.0.0.1:4025 → Mumbai's 127.0.0.1:4025 so this call looks local.
//
// Reads DWOTP_URL / DWOTP_INTERNAL_TOKEN / MAIL_FROM at call time so a pm2
// restart with new envs picks up without a rebuild. If either the URL or
// token is missing we fail-open (log to stdout + return ok) so dev/staging
// still work without the tunnel.

interface MailInput { to: string; subject: string; html: string; text?: string; }

/** Set by MailHealthService. Every real send reports its outcome here, which is
 *  how a broken mail path gets noticed even though no caller checks the return
 *  value — sendMail fails open by design, and that is exactly what hid a 5-day
 *  outage in Aug 2026. The /health probe can't see send-level rejections (DKIM,
 *  MX refusal, a 403 from a relay), so this is the second, independent signal. */
let observer: ((ok: boolean, error?: string) => void) | null = null;
export function setMailObserver(fn: (ok: boolean, error?: string) => void): void { observer = fn; }
const observe = (ok: boolean, error?: string) => { try { observer?.(ok, error); } catch { /* must never break a send */ } };

export async function sendMail({ to, subject, html, text }: MailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const url   = process.env.DWOTP_URL || "http://127.0.0.1:4025";
  const token = process.env.DWOTP_INTERNAL_TOKEN;
  const from  = process.env.MAIL_FROM || "ChessGuru <noreply@otp.dreamworldplants.com>";
  if (!token) {
    console.log(`[mail:noop] to=${to} subject=${JSON.stringify(subject)} — set DWOTP_INTERNAL_TOKEN to actually send`);
    console.log(`[mail:noop] body:\n${text || html.replace(/<[^>]+>/g, "")}`);
    return { ok: true, id: "noop" };
  }
  try {
    const r = await fetch(`${url}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": token },
      body: JSON.stringify({ to, from, subject, html, text }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      console.warn(`[mail] dw-otp HTTP ${r.status}: ${err.slice(0, 200)}`);
      observe(false, `dw-otp HTTP ${r.status}: ${err.slice(0, 200)}`);
      return { ok: false, error: `dwotp_${r.status}` };
    }
    const j = (await r.json()) as { ok?: boolean; mx?: string; error?: string };
    if (!j.ok) {
      observe(false, `dw-otp rejected: ${j.error || "no reason given"}`);
      return { ok: false, error: j.error || "dwotp_reject" };
    }
    observe(true);
    return { ok: true, id: j.mx };
  } catch (e) {
    console.warn(`[mail] dw-otp send failed:`, e);
    observe(false, String((e as any)?.message || e));
    return { ok: false, error: String(e) };
  }
}
