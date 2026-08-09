// Minimal Resend HTTP wrapper — no SDK dep. Used for password-reset links
// and OTP sign-in codes. Reads RESEND_API_KEY + MAIL_FROM at call time.
//
// If RESEND_API_KEY is unset we fail-open (log to stdout + return ok) so
// dev / staging still work without a key configured.

interface MailInput { to: string; subject: string; html: string; text?: string; }

export async function sendMail({ to, subject, html, text }: MailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "ChessGuru <noreply@dreamworldplants.in>";
  if (!key) {
    console.log(`[mail:noop] to=${to} subject=${JSON.stringify(subject)} — set RESEND_API_KEY to actually send`);
    console.log(`[mail:noop] body:\n${text || html.replace(/<[^>]+>/g, "")}`);
    return { ok: true, id: "noop" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      console.warn(`[mail] Resend HTTP ${r.status}: ${err.slice(0, 200)}`);
      return { ok: false, error: `resend_${r.status}` };
    }
    const j = (await r.json()) as { id?: string };
    return { ok: true, id: j.id };
  } catch (e) {
    console.warn(`[mail] send failed:`, e);
    return { ok: false, error: String(e) };
  }
}
