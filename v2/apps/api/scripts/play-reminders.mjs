// Bookmark-reminder cron: sends emails 3 days + 24 hours before each bookmarked
// tournament. Idempotent (marks reminder_{3d,1d}_sent_at on play_favorites doc).
// Run hourly. Uses dw-otp for DKIM-signed direct-MX delivery.

import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chessguru";
const DWOTP_URL   = process.env.DWOTP_URL || "http://127.0.0.1:4025";
const DWOTP_TOKEN = process.env.DWOTP_INTERNAL_TOKEN;
const MAIL_FROM   = process.env.PLAY_MAIL_FROM || "ChessGuru Play <reminders@chessguru.cc>";
const SITE_URL    = "https://play.chessguru.cc";
const DRY_RUN     = process.env.DRY_RUN === "1";

// Window we consider a reminder "due" for a given tournament. We run hourly, so
// a 2-hour window catches the mail we owe on this pass with no doubles.
const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

async function sendMail({ to, subject, html, text }) {
  if (DRY_RUN || !DWOTP_TOKEN) {
    console.log(`  [DRY] mail to=${to}  subject=${JSON.stringify(subject)}`);
    return { ok: true, id: "dry" };
  }
  try {
    const r = await fetch(`${DWOTP_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": DWOTP_TOKEN },
      body: JSON.stringify({ to, from: MAIL_FROM, subject, html, text }),
    });
    if (!r.ok) { console.warn(`  MAIL HTTP ${r.status}`); return { ok: false }; }
    const j = await r.json();
    return { ok: !!j.ok };
  } catch (e) {
    console.warn(`  MAIL threw`, e.message);
    return { ok: false };
  }
}

const rupees = (paise) => paise == null ? "" : "₹" + (paise/100).toLocaleString("en-IN");
const dateLong = (iso) => new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function buildEmail(t, kind, ownerName) {
  const daysLabel = kind === "3d" ? "in 3 days" : "tomorrow";
  const urgent = kind === "1d";
  const subject = urgent
    ? `⏰ Tomorrow: ${t.name}`
    : `📅 In 3 days: ${t.name}`;
  const url = `${SITE_URL}/t?id=${encodeURIComponent(t._id)}`;
  const text = [
    `Hi ${ownerName || "there"},`,
    ``,
    `Your bookmarked tournament is ${daysLabel}:`,
    ``,
    `${t.name}`,
    `📅 ${dateLong(t.start_date)}`,
    `📍 ${[t.city, t.district, t.state].filter(Boolean).join(", ") || t.location_raw || ""}`,
    t.entry_fee_paise != null ? `🎟️ Entry ${rupees(t.entry_fee_paise)}` : "",
    t.prize_pool_paise != null ? `🏆 Prize ${rupees(t.prize_pool_paise)}` : "",
    ``,
    `See full details + register: ${url}`,
    ``,
    urgent
      ? `Not too late to prep — daily puzzles at your rating on https://chessguru.cc — free.`
      : `Sharpen up in 3 days with daily puzzles at https://chessguru.cc — free.`,
    ``,
    `— ChessGuru Play`,
    `You're getting this because you bookmarked this tournament on play.chessguru.cc.`,
    `Unsubscribe: reply STOP to this email or remove the bookmark on the site.`,
  ].filter(Boolean).join("\n");
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;background:#0a0f1c;color:#f4f4f5;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.4));border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08)">
      <div style="font-weight:700;font-size:14px"><span style="color:#fbbf24">♟</span> ChessGuru Play</div>
    </div>
    <div style="padding:24px">
      <div style="display:inline-block;padding:4px 10px;border-radius:9999px;font-size:11px;font-weight:700;color:#000;background:${urgent ? "linear-gradient(135deg,#f472b6,#ef4444)" : "linear-gradient(135deg,#fbbf24,#f59e0b)"}">
        ${urgent ? "🔥 TOMORROW" : "⏰ IN 3 DAYS"}
      </div>
      <h1 style="font-size:22px;margin:14px 0 8px 0;line-height:1.25;color:#fff">${t.name}</h1>
      <div style="color:rgba(244,244,245,0.7);font-size:13px;margin-bottom:16px">Organized by ${t.organizer_name || "—"}</div>
      <div style="font-size:14px;color:#f4f4f5;line-height:1.7">
        📅 ${dateLong(t.start_date)}<br>
        📍 ${[t.city, t.district, t.state].filter(Boolean).join(", ") || t.location_raw || ""}<br>
        ${t.entry_fee_paise != null ? `🎟️ Entry ${rupees(t.entry_fee_paise)}<br>` : ""}
        ${t.prize_pool_paise != null ? `🏆 Prize ${rupees(t.prize_pool_paise)}<br>` : ""}
      </div>
      <div style="margin-top:22px">
        <a href="${url}" style="display:inline-block;padding:12px 22px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;text-decoration:none;font-weight:700;border-radius:9999px;font-size:14px">View details + Register →</a>
      </div>
    </div>
    <div style="padding:16px 24px;background:rgba(251,191,36,0.06);border-top:1px solid rgba(255,255,255,0.08);font-size:12px;color:rgba(244,244,245,0.75)">
      💡 <b>Prep tip:</b> ${urgent ? "One warm-up set won't hurt tonight." : "3 days = 3 puzzle sessions."} Free daily puzzles at your rating on <a href="https://chessguru.cc" style="color:#fbbf24;text-decoration:none">chessguru.cc</a>.
    </div>
    <div style="padding:14px 24px;font-size:11px;color:rgba(244,244,245,0.4);border-top:1px solid rgba(255,255,255,0.05)">
      You're getting this because you bookmarked this tournament on play.chessguru.cc. Remove the bookmark to stop these emails.
    </div>
  </div>
</div>`.trim();
  return { subject, html, text };
}

(async () => {
  const started = Date.now();
  console.log(`[${new Date().toISOString()}] play-reminders start${DRY_RUN ? " (DRY RUN)" : ""}`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const favs   = db.collection("play_favorites");
  const users  = db.collection("users");
  const tsCol  = db.collection("tournaments");

  const now = Date.now();
  const kinds = [
    { k: "3d", from: 3 * DAY - HOUR, to: 3 * DAY + HOUR, marker: "reminder_3d_sent_at" },
    { k: "1d", from: 1 * DAY - HOUR, to: 1 * DAY + HOUR, marker: "reminder_1d_sent_at" },
  ];

  let scanned = 0, sent = 0, skipped = 0, errors = 0;
  for (const { k, from, to, marker } of kinds) {
    // Tournaments whose start_date falls in the window
    const windowStart = new Date(now + from);
    const windowEnd   = new Date(now + to);
    const inWindow = await tsCol.find({
      start_date: { $gte: windowStart, $lte: windowEnd },
      hidden: { $ne: true },
    }).toArray();
    console.log(`  ${k}: ${inWindow.length} tournaments in window`);

    for (const t of inWindow) {
      const bookmarked = await favs.find({ tournament_id: t._id, [marker]: { $exists: false } }).toArray();
      for (const fav of bookmarked) {
        scanned++;
        const user = await users.findOne({ _id: fav.user_id });
        if (!user?.email) { skipped++; continue; }
        const email = buildEmail(t, k, user.fullName || user.username || null);
        const r = await sendMail({ to: user.email, ...email });
        if (r.ok) {
          await favs.updateOne({ _id: fav._id }, { $set: { [marker]: new Date() } });
          sent++;
          console.log(`  ✓ ${k} → ${user.email}  ${t.name.slice(0, 50)}`);
        } else {
          errors++;
          console.log(`  ✗ ${k} → ${user.email}  (${t.name.slice(0, 50)})`);
        }
      }
    }
  }
  await client.close();
  console.log(`[${new Date().toISOString()}] done  scanned=${scanned} sent=${sent} skipped=${skipped} errors=${errors}  in ${((Date.now() - started) / 1000).toFixed(0)}s`);
})();
