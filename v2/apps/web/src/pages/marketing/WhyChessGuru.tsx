// WhyChessGuru — /why-chessguru (ChessPlay's /why-chessplay): the problems,
// the fixes, the hidden cost of the DIY stack in rupees, flat price, with/without.

import MarketingShell, { Accent, Card, Check, Eyebrow, H2, PrimaryCTA, Section, WhatsAppCTA, useMarketingTitle, M } from "./MarketingShell";
import { DIY_ADMIN_HOURS_PER_WEEK, DIY_ADMIN_HOUR_INR, DIY_STACK, PRICE_MONTHLY, PROBLEMS, TRIAL_DAYS } from "./data";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const STICKIES = ["Which student account?", "Have they paid yet?", "Who enrolled this month?", "Where's the PGN?", "Send the report again?"];

export default function WhyChessGuruPage() {
  useMarketingTitle("Why ChessGuru — run your chess academy a lot more smoothly");
  const subs = DIY_STACK.reduce((s, t) => s + t.inr, 0);
  const admin = DIY_ADMIN_HOURS_PER_WEEK * DIY_ADMIN_HOUR_INR * 4;
  return (
    <MarketingShell>
      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-14 pb-16 md:pt-20 md:pb-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow>Why ChessGuru</Eyebrow>
            <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>You could be running your academy <Accent>a lot more smoothly</Accent></h1>
            <p className="mt-6 text-lg leading-relaxed max-w-xl" style={{ color: M.ink2 }}>ChessGuru is the easiest way to enrol more students, keep parents close and keep your coaches around longer — while spending less time on admin.</p>
            <div className="mt-8 flex flex-wrap gap-3"><PrimaryCTA /><WhatsAppCTA text="Get a free demo" /></div>
          </div>
          <div className="relative h-72 md:h-80">
            {STICKIES.map((s, i) => (
              <div key={s} className="absolute rounded-xl px-4 py-3 text-sm font-bold shadow-lg" style={{ background: ["#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#fed7aa"][i], color: M.ink, left: `${[4, 48, 20, 58, 30][i]}%`, top: `${[8, 4, 40, 52, 76][i]}%`, transform: `rotate(${[-6, 4, -3, 6, -5][i]}deg)` }}>{s}</div>
            ))}
          </div>
        </div>
      </section>

      <Section tone="peach">
        <Eyebrow>The real problems you're dealing with</Eyebrow>
        <div className="mt-4"><H2 sub="ChessGuru saves you hours and recovers fees by putting every tool, file and conversation into one system of truth.">Stop firefighting. <Accent>Start coaching.</Accent></H2></div>
        <div className="space-y-5">
          {PROBLEMS.map((p) => (
            <div key={p.p} className="grid md:grid-cols-2 gap-4 rounded-[28px] border overflow-hidden" style={{ borderColor: M.line }}>
              <div className="p-7" style={{ background: "#fff1f2" }}>
                <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#be123c" }}>The problem</div>
                <div className="mt-2 text-xl font-black">{p.p}</div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{p.pd}</p>
              </div>
              <div className="p-7" style={{ background: M.card }}>
                <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#15803d" }}>✓ ChessGuru fixes it</div>
                <div className="mt-2 text-xl font-black">{p.f}</div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{p.fd}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <Eyebrow>The hidden cost of duct-taped tools</Eyebrow>
        <div className="mt-4"><H2 sub="Most academies are surprised when they add up what they spend each month on subscriptions — before counting the hours lost to admin. Figures below are typical Indian list prices, rounded.">You're already paying for <Accent>8 tools</Accent>. Replace them with one.</H2></div>
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <Card>
            <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: M.ink3 }}>Your current stack (per month)</div>
            <ul className="mt-4 divide-y" style={{ borderColor: M.line }}>
              {DIY_STACK.map((t) => (
                <li key={t.tool} className="flex justify-between gap-4 py-2.5 text-sm"><span style={{ color: M.ink2 }}>{t.tool}</span><span className="font-bold whitespace-nowrap">{t.inr ? inr(t.inr) : "free"}</span></li>
              ))}
            </ul>
            <div className="mt-4 pt-4 border-t space-y-1.5 text-sm" style={{ borderColor: M.line }}>
              <div className="flex justify-between"><span>Subscriptions</span><b>{inr(subs)}/mo</b></div>
              <div className="flex justify-between"><span>+ ~{DIY_ADMIN_HOURS_PER_WEEK} admin hrs/wk × {inr(DIY_ADMIN_HOUR_INR)}</span><b>{inr(admin)}/mo</b></div>
              <div className="flex justify-between text-base pt-1"><span className="font-bold">True cost</span><b style={{ color: "#be123c" }}>~{inr(subs + admin)}/mo</b></div>
            </div>
          </Card>
          <div className="rounded-[28px] border-2 p-7 md:p-8" style={{ borderColor: M.orange, background: M.card, boxShadow: "0 30px 80px rgba(249,115,22,0.15)" }}>
            <div className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#15803d" }}>✓ With ChessGuru</div>
            <div className="mt-2 text-2xl font-black">One platform, one bill</div>
            <ul className="mt-4 space-y-2">
              {["Academy dashboard: batches, coaches, students, roles", "Live classroom with Dream Meet video + shared board", "Puzzles, homework, curriculum, study tools", "Attendance, fees over UPI, reminders", "Parent reports, analytics, exports", "Tournament arbiter, public results, scoresheet scanner", "Your domain, your branding"].map((b) => <Check key={b}>{b}</Check>)}
            </ul>
            <div className="mt-6 flex items-end gap-2">
              <span className="text-5xl font-black" style={{ color: M.orange }}>{inr(PRICE_MONTHLY)}</span><span className="pb-1.5 font-semibold" style={{ color: M.ink2 }}>/ month · flat</span>
            </div>
            <div className="text-sm font-semibold mt-1">Unlimited students. Unlimited coaches. Every feature.</div>
            <div className="text-xs mt-1" style={{ color: M.ink3 }}>No per-student fees, no add-ons. Your price stays the same as your academy grows.</div>
            <PrimaryCTA className="mt-6 w-full">Start {TRIAL_DAYS} days free →</PrimaryCTA>
          </div>
        </div>
      </Section>

      <Section tone="white">
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <div className="rounded-3xl p-7" style={{ background: "#fff1f2" }}>
            <div className="text-lg font-black" style={{ color: "#be123c" }}>Without ChessGuru</div>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: M.ink2 }}>{["8+ disconnected tools", "Hours lost to double entry", "Parents asking for updates", "Fees slipping every month", "Coaches drowning in admin"].map((x) => <li key={x}>✕ {x}</li>)}</ul>
          </div>
          <div className="rounded-3xl p-7" style={{ background: "#f0fdf4" }}>
            <div className="text-lg font-black" style={{ color: "#15803d" }}>With ChessGuru</div>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: M.ink2 }}>{["One platform, one login", "10+ hours saved every week", "Reports parents share with friends", "Fees on autopilot", "Coaches doing what they love"].map((x) => <li key={x}>✓ {x}</li>)}</ul>
          </div>
        </div>
      </Section>
    </MarketingShell>
  );
}
