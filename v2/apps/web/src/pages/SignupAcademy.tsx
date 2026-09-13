// SignupAcademy — home of the academy marketing set (/signup-academy).
//
// Owner 2026-09-13: "read chessplay.io, need academy signup pages like that,
// multiple pages". Structure mirrors ChessPlay's home: hero (badge → headline
// with one orange word → sub → CTAs) · live proof strip · product tour with
// tab pills · "what is" tiles · for-students · operations · built-for cards →
// /for-* pages · numbers/why · testimonials · pricing · FAQ · CTA banner.
// Kept on purpose: the self-serve trial form sits IN the hero (owner 2026-09-10).
// Sibling pages: pages/marketing/{BuiltFor,WhyChessGuru,Compare,FeaturePage}.tsx.
// Images: /marketing/*.webp (Gemini, warm painterly) + /feature-shots/*.png (real app).

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FEATURES, CATEGORY_META, type FeatureCategory } from "../lib/features";
import { get } from "../lib/api";
import MarketingShell, { Accent, Card, Check, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M, CTA_STYLE } from "./marketing/MarketingShell";
import TrialSignupForm from "./marketing/TrialSignupForm";
import { AUDIENCES, FAQ, PRICE_MONTHLY, PRICE_YEARLY, TRIAL_DAYS, TRIAL_HREF, WHATSAPP_DISPLAY } from "./marketing/data";

// Product tour tabs (ChessPlay: Classrooms · Quizzes · Tournaments · Reports · Attendance · Leaderboard)
const TOUR: Array<{ key: string; label: string; cat: FeatureCategory; img: string; title: string; body: string; bullets: string[] }> = [
  { key: "live", label: "Live classes", cat: "classes", img: "/marketing/cat-live.webp", title: "Run live, recurring classes on your own board.",
    body: "Dream Meet video is built in — no separate meeting link. Coaches teach on a shared board, students follow on any phone, parents see attendance the same minute.",
    bullets: ["Arrows, circles and Snap-position broadcast to every screen", "One-click recording, replay for absent students", "Class reminders 24h / 1h / 15 min before"] },
  { key: "homework", label: "Homework & puzzles", cat: "puzzles", img: "/marketing/cat-puzzles.webp", title: "Homework that grades itself.",
    body: "Assign rated puzzles by theme and difficulty the moment class ends. Students solve on their phone; you see who did what, and where each one is weak.",
    bullets: ["Glicko-rated trainer across 60+ tactical themes", "Puzzle of the Day shared by the whole academy", "Wrong-move review shows the refutation"] },
  { key: "academy", label: "Fees & attendance", cat: "academy", img: "/marketing/cat-academy.webp", title: "The running of the academy, one dashboard.",
    body: "Coaches, students, batches, invites, fees and attendance in one place. Paid / due / waived at a glance; reminders go out without you.",
    bullets: ["Monthly fee per batch or student, UPI collection", "Attendance captured when a student joins class", "Invite coaches by email, students by link or code"] },
  { key: "reports", label: "Parent reports", cat: "analytics", img: "/marketing/cat-analytics.webp", title: "Reports parents brag about.",
    body: "Branded monthly progress reports with rating curves, puzzles solved, attendance and coach notes — shared as a link or PDF.",
    bullets: ["Per-theme strengths and weaknesses", "13-week activity heatmap and personal bests", "CSV export of every solve, any time"] },
  { key: "study", label: "Study & curriculum", cat: "study", img: "/marketing/cat-study.webp", title: "A curriculum your coaches can assign week by week.",
    body: "Coordinate trainer, opening trainer, endgame manual, memory palace, opening tree — from first lesson to club strength.",
    bullets: ["Named openings with move-by-move drills", "Endgame manual: rule of the square, KPK, opposition", "Snap a printed diagram with your phone → it opens on the board"] },
  { key: "play", label: "Play & tournaments", cat: "play", img: "/marketing/cat-play.webp", title: "Games, engines, arbiter, scoresheets.",
    body: "Pass & play, engine battles, a board editor, and a tournament arbiter with Swiss pairings and public results. Paper games become PGN with the scoresheet scanner.",
    bullets: ["Swiss pairings, live standings, public results page", "Handwritten scoresheet → PGN in one photo", "Engine analysis of every imported game"] },
];

const WHAT = [
  { e: "🎥", t: "Teach live", d: "Recurring classes with a shared board and built-in video.", tag: "Classroom ready" },
  { e: "🧩", t: "Assign & grade", d: "Rated puzzles and homework that grade themselves instantly.", tag: "Full automation" },
  { e: "🏆", t: "Tournaments", d: "Swiss pairings and public results in seconds. Scan the scoresheets after.", tag: "One-click events" },
  { e: "📈", t: "Wow parents", d: "Branded monthly reports parents actually open and share.", tag: "Branded reports" },
];

const OPS = [
  { e: "💳", t: "Fees on autopilot", d: "Track dues, send reminders and collect over UPI without manual follow-ups." },
  { e: "✅", t: "Attendance & student tracking", d: "See who came, who's drifting, and who's improving — per batch, per coach." },
  { e: "🗓️", t: "Scheduling & homework", d: "Recurring classes, assignments and class plans from one place." },
  { e: "👨‍👩‍👧", t: "Parent communication & reports", d: "Progress reports, attendance and announcements, shared instantly." },
];

const WHY = [
  { t: "Save 10+ hours a week", d: "Stop juggling Sheets, Zoom and WhatsApp. Everything lives in one place." },
  { t: "Engage every student", d: "Daily puzzle, streaks, blindfold rating and milestones turn practice into something kids look forward to." },
  { t: "Look like the pros", d: "Your logo, your domain, branded reports — a premium experience parents happily pay for." },
  { t: "Grow without growing the bill", d: `₹${PRICE_MONTHLY.toLocaleString("en-IN")}/month whether you have 30 students or 3,000.` },
];

function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) { setN(0); return; }
    const start = performance.now(); let raf = 0;
    const tick = (now: number) => { const t = Math.min(1, (now - start) / ms); setN(Math.round(target * (1 - Math.pow(1 - t, 3)))); if (t < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

export default function SignupAcademyPage() {
  useMarketingTitle("Chess Academy Software to Teach Chess Online | ChessGuru");
  const [stats, setStats] = useState<{ academies: number; students: number; coaches: number; puzzlesSolvedWeek: number } | null>(null);
  useEffect(() => { get<any>("/api/public/stats").then(setStats).catch(() => setStats(null)); }, []);
  const nAcademies = useCountUp(stats?.academies ?? 0);
  const nCoaches = useCountUp(stats?.coaches ?? 0);
  const nStudents = useCountUp(stats?.students ?? 0);
  const nPuzzles = useCountUp(stats?.puzzlesSolvedWeek ?? 0);

  const [tab, setTab] = useState(TOUR[0]!.key);
  const tour = TOUR.find((t) => t.key === tab) ?? TOUR[0]!;
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const featureCount = useMemo(() => FEATURES.length, []);

  return (
    <MarketingShell>
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <span className="absolute left-2 top-24 text-[120px] leading-none select-none opacity-[0.08] hidden md:block">♜</span>
        <span className="absolute right-4 bottom-4 text-[160px] leading-none select-none opacity-[0.08] hidden md:block">♞</span>
        <div className="max-w-6xl mx-auto px-6 pt-14 pb-16 md:pt-20 md:pb-24 grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          <div>
            <Eyebrow>♟ Built for chess academies</Eyebrow>
            <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(40px, 6.2vw, 72px)" }}>
              Run your entire chess academy with <Accent>ChessGuru</Accent>
            </h1>
            <p className="mt-6 text-lg md:text-xl leading-relaxed max-w-xl" style={{ color: M.ink2 }}>
              Live classes, puzzles, homework, fees, attendance, parent reports and scoresheet scanning — one platform your students already love opening every day.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PrimaryCTA href="#signup" />
              <WhatsAppCTA text="Get a free demo" />
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold" style={{ color: M.ink2 }}>
              <span>✓ {TRIAL_DAYS} days free</span><span>✓ No card</span><span>✓ ₹{PRICE_MONTHLY.toLocaleString("en-IN")}/month after</span><span>✓ Unlimited students & coaches</span>
            </div>
          </div>
          <TrialSignupForm />
        </div>
      </section>

      {/* ── Live proof strip ─────────────────────────────────────────── */}
      <div className="border-y" style={{ borderColor: M.line, background: "rgba(255,255,255,0.6)" }}>
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="text-center text-[11px] font-bold tracking-widest uppercase mb-4" style={{ color: M.ink3 }}>Live numbers from chessguru.cc — right now</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            {[[nAcademies, "Academies on ChessGuru"], [nCoaches, "Coaches teaching"], [nStudents, "Students learning"], [nPuzzles, "Puzzles solved this week"]].map(([n, l], i) => (
              <div key={i}>
                <div className="text-3xl md:text-4xl font-black" style={{ color: M.orange }}>{(n as number).toLocaleString("en-IN")}</div>
                <div className="text-xs font-semibold mt-1" style={{ color: M.ink2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Marquee: everything included (ChessPlay's logo strip slot) ── */}
      <div className="overflow-hidden py-5 border-b" style={{ borderColor: M.line }}>
        <div className="text-center text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: M.ink3 }}>Everything below is on the single ₹{PRICE_MONTHLY.toLocaleString("en-IN")}/month plan</div>
        <div className="flex gap-3 whitespace-nowrap cg-marquee">
          {[...FEATURES, ...FEATURES].map((f, i) => (
            <span key={i} className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold" style={{ borderColor: M.line, background: M.card, color: M.ink2 }}>{f.emoji} {f.title}</span>
          ))}
        </div>
        <style>{`@keyframes cg-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } } .cg-marquee { width: max-content; animation: cg-marquee 90s linear infinite; } .cg-marquee:hover { animation-play-state: paused; }`}</style>
      </div>

      {/* ── What is ChessGuru ───────────────────────────────────────── */}
      <Section>
        <Eyebrow>What is ChessGuru?</Eyebrow>
        <div className="mt-4"><H2 sub="Replace spreadsheets, WhatsApp groups and Zoom links with a single branded platform that students love and parents trust.">Built for chess coaches. <Accent>Trusted by academies.</Accent></H2></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {WHAT.map((w) => (
            <Card key={w.t}>
              <div className="text-3xl">{w.e}</div>
              <div className="mt-3 text-lg font-black">{w.t}</div>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: M.ink2 }}>{w.d}</p>
              <div className="mt-4 inline-block rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: M.orangeSoft, color: M.orange2 }}>{w.tag}</div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── Product tour (tab pills) ─────────────────────────────────── */}
      <Section tone="peach" id="tour">
        <Eyebrow>Platform</Eyebrow>
        <div className="mt-4"><H2 sub={`${featureCount}+ features, every one of them on the single plan. Pick a tab.`}>Get to know <Accent>ChessGuru</Accent></H2></div>
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {TOUR.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="rounded-full px-4 py-2 text-sm font-bold border transition" style={tab === t.key ? { ...CTA_STYLE, borderColor: "transparent" } : { borderColor: M.line, background: M.card, color: M.ink2 }}>
              {t.label}
            </button>
          ))}
        </div>
        <Card className="grid lg:grid-cols-2 gap-8 items-center !p-4 md:!p-6">
          <div className="rounded-2xl overflow-hidden aspect-[4/3]" style={{ background: M.bg2 }}>
            <img src={tour.img} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div className="p-2 md:p-4">
            <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.orange2 }}>{CATEGORY_META[tour.cat].label}</div>
            <h3 className="mt-2 text-2xl md:text-3xl font-black tracking-tight leading-tight">{tour.title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{tour.body}</p>
            <ul className="mt-5 space-y-3">{tour.bullets.map((b) => <Check key={b}>{b}</Check>)}</ul>
            <Link to={`/features/${tour.cat}`} className="mt-6 inline-block text-sm font-bold underline underline-offset-4" style={{ color: M.orange2 }}>All {CATEGORY_META[tour.cat].label.toLowerCase()} features →</Link>
          </div>
        </Card>
      </Section>

      {/* ── For students ─────────────────────────────────────────────── */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow>For students</Eyebrow>
            <h2 className="font-black tracking-tight leading-[1.05] mt-4" style={{ fontSize: "clamp(30px, 4.6vw, 52px)" }}>Make every student <Accent>fall in love</Accent> with chess</h2>
            <p className="mt-4 text-base md:text-lg" style={{ color: M.ink2 }}>Play, solve and improve — all inside ChessGuru. No juggling tabs between Lichess, Chess.com and a separate analysis board.</p>
            <ul className="mt-6 space-y-3">
              <Check><b>Puzzle of the Day + streaks.</b> The same challenge the whole academy is solving today; a streak worth protecting.</Check>
              <Check><b>Blindfold mode with its own rating.</b> A separate belt to earn — students love it.</Check>
              <Check><b>Play vs engine, pass & play, engine battles.</b> A tunable opponent for warm-ups and rainy weekends.</Check>
              <Check><b>Analysis board + game import.</b> Every game reviewed move by move; blunders become next week's homework.</Check>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[["/feature-shots/puzzle-trainer.png", "Rated puzzle trainer"], ["/feature-shots/blindfold.png", "Blindfold mode"], ["/feature-shots/puzzle-of-the-day.png", "Puzzle of the Day"], ["/feature-shots/engine-battle.png", "Engine battle"]].map(([src, label]) => (
              <div key={src} className="rounded-2xl overflow-hidden border" style={{ borderColor: M.line, background: M.card }}>
                <img src={src} alt={label} className="w-full aspect-[3/2] object-cover" loading="lazy" />
                <div className="px-3 py-2 text-xs font-bold" style={{ color: M.ink2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Operations ──────────────────────────────────────────────── */}
      <Section tone="white">
        <Eyebrow>Operations</Eyebrow>
        <div className="mt-4"><H2 sub="Simplify daily academy operations with tools built specifically for chess.">Run your academy <Accent>with ease</Accent></H2></div>
        <div className="grid sm:grid-cols-2 gap-5">
          {OPS.map((o) => (
            <div key={o.t} className="flex gap-4 rounded-3xl border p-6" style={{ borderColor: M.line, background: M.bg }}>
              <div className="text-3xl">{o.e}</div>
              <div><div className="text-lg font-black">{o.t}</div><p className="mt-1 text-sm leading-relaxed" style={{ color: M.ink2 }}>{o.d}</p></div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Built for ───────────────────────────────────────────────── */}
      <Section>
        <Eyebrow>Built for</Eyebrow>
        <div className="mt-4"><H2 sub="From solo coaches to multi-branch academies and school programmes — same platform, same price.">Built for chess programmes <Accent>of all sizes</Accent></H2></div>
        <div className="grid md:grid-cols-3 gap-5">
          {(["coaches", "academies", "schools"] as const).map((k) => {
            const a = AUDIENCES[k];
            return (
              <Link key={k} to={`/for-${k}`} className="group rounded-3xl overflow-hidden border hover:-translate-y-1 transition" style={{ borderColor: M.line, background: M.card }}>
                <div className="aspect-[4/3] overflow-hidden"><img src={a.img} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" /></div>
                <div className="p-6">
                  <div className="text-xl font-black">{a.nav}</div>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{a.jobs[0]?.d}</p>
                  <div className="mt-4 text-sm font-bold" style={{ color: M.orange2 }}>Learn more →</div>
                </div>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* ── Why ─────────────────────────────────────────────────────── */}
      <Section tone="peach">
        <Eyebrow>Why ChessGuru</Eyebrow>
        <div className="mt-4"><H2>Running an academy, <Accent>finally easy</Accent></H2></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {WHY.map((w, i) => (
            <Card key={w.t}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-white" style={{ background: M.orange }}>{i + 1}</div>
              <div className="mt-4 text-lg font-black">{w.t}</div>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: M.ink2 }}>{w.d}</p>
            </Card>
          ))}
        </div>
        <div className="text-center mt-8"><Link to="/why-chessguru" className="font-bold underline underline-offset-4" style={{ color: M.orange2 }}>See why academies switch →</Link></div>
      </Section>

      {/* ── Testimonials (honest placeholder until we have permission) ── */}
      <Section>
        <Eyebrow>Customer love</Eyebrow>
        <div className="mt-4"><H2 sub="We're collecting real quotes from our first academies and will publish them with permission. Yours could be here next.">Hear what our <Accent>early academies</Accent> say</H2></div>
        <div className="grid md:grid-cols-3 gap-5">
          {(["academies", "coaches", "schools"] as const).map((k, i) => (
            <Card key={k}>
              <div className="text-4xl leading-none" style={{ color: M.orange }}>“</div>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: M.ink }}>{AUDIENCES[k].quote.text}</p>
              <div className="mt-5 flex items-center gap-3">
                <img src={`/marketing/avatar-${i + 1}.webp`} alt="" className="w-11 h-11 rounded-full object-cover" loading="lazy" />
                <div><div className="text-sm font-bold">{AUDIENCES[k].quote.who}</div><div className="text-xs" style={{ color: M.ink3 }}>{AUDIENCES[k].quote.meta}</div></div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── Pricing ─────────────────────────────────────────────────── */}
      <Section tone="white" id="pricing" className="scroll-mt-28">
        <Eyebrow>Simple pricing</Eyebrow>
        <div className="mt-4"><H2 sub={`₹${PRICE_MONTHLY.toLocaleString("en-IN")} a month, unlimited students, unlimited coaches, every feature. The first ${TRIAL_DAYS} days are free, no card needed.`}>One price. <Accent>Everything included.</Accent></H2></div>
        <div className="max-w-xl mx-auto">
          <div className="relative rounded-[28px] border-2 p-8 md:p-10" style={{ borderColor: M.orange, background: M.bg, boxShadow: "0 30px 80px rgba(249,115,22,0.15)" }}>
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-black text-white" style={{ background: M.orange }}>Flat price · unlimited students</div>
            <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.ink3 }}>Academy</div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-6xl font-black tracking-tight" style={{ color: M.orange }}>₹{PRICE_MONTHLY.toLocaleString("en-IN")}</span>
              <span className="pb-2 text-base font-semibold" style={{ color: M.ink2 }}>/ month</span>
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: M.ink2 }}>or ₹{PRICE_YEARLY.toLocaleString("en-IN")} / year — 2 months free</div>
            <ul className="mt-6 space-y-3">
              <Check>Unlimited students and unlimited coaches, every branch</Check>
              <Check>Live classes with Dream Meet, puzzles, studies, homework</Check>
              <Check>Fees, attendance, parent reports, tournaments, scoresheet scanning</Check>
              <Check>Your own domain and branding</Check>
              <Check>{TRIAL_DAYS} days free, no card, cancel any time</Check>
            </ul>
            <PrimaryCTA href={TRIAL_HREF} className="mt-8 w-full">Start free — no card →</PrimaryCTA>
            <div className="mt-3 text-center text-xs" style={{ color: M.ink3 }}>Questions? WhatsApp {WHATSAPP_DISPLAY}</div>
          </div>
        </div>
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <Section id="faq" className="scroll-mt-28">
        <Eyebrow>FAQ</Eyebrow>
        <div className="mt-4"><H2>Questions, <Accent>answered</Accent></H2></div>
        <div className="max-w-3xl mx-auto space-y-2">
          {FAQ.map((item, i) => (
            <div key={i} className="rounded-2xl border overflow-hidden" style={{ borderColor: M.line, background: M.card }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-orange-50">
                <span className="font-bold text-[15px]">{item.q}</span>
                <span className="text-xl" style={{ color: M.orange }}>{openFaq === i ? "−" : "+"}</span>
              </button>
              {openFaq === i && <div className="px-5 pb-4 text-sm leading-relaxed" style={{ color: M.ink2 }}>{item.a}</div>}
            </div>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
