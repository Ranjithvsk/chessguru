import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { STUDIES, type StudyDef } from "../lib/studies";
import { studyLevels, type StudyLevel } from "../lib/api";

function tier(avg: number) {
  if (avg < 1000) return "Beginner";
  if (avg < 1400) return "Intermediate";
  if (avg < 1800) return "Advanced";
  return "Expert";
}
// Curated concept range → chip label. Spanning label ("Beginner–Intermediate")
// when the range's endpoints fall in different tiers so wide-reach trainers
// (e.g. Coordinates 400–1200) don't undersell their accessibility.
function tierLabel(range: [number, number]): string {
  const t1 = tier(range[0]), t2 = tier(range[1]);
  return t1 === t2 ? t1 : `${t1}–${t2}`;
}
function RangeChip({ range }: { range: [number, number] }) {
  return (
    <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-300"
      title={`Curated difficulty ${range[0]}–${range[1]}`}>
      ★ {range[0]}–{range[1]} · {tierLabel(range)}
    </span>
  );
}

function StudyCard({ s, level }: { s: StudyDef; level?: StudyLevel }) {
  return (
    <Link to={`/study/${s.id}`}
      className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">{s.icon}</span>
        <div>
          <h2 className="font-display text-lg text-white">{s.title}</h2>
          <p className="text-xs text-ink-400">{s.blurb}</p>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm text-ink-400">{s.detail}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">{s.mateIn}</span>
          {s.range && <RangeChip range={s.range} />}
          {level && level.n > 0 && (
            <span className="rounded-full bg-accent-500/15 px-2.5 py-1 text-[11px] font-semibold text-accent-400"
              title={`${level.n} rated puzzles · ${level.min}–${level.max} (your play data)`}>
              you: ~{level.avg}
            </span>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
      </div>
    </Link>
  );
}

export default function StudyPage() {
  const [levels, setLevels] = useState<Record<string, StudyLevel>>({});
  const [q, setQ] = useState("");
  useEffect(() => { studyLevels().then(setLevels).catch(() => { /* ratings optional */ }); }, []);

  const needle = q.trim().toLowerCase();
  const matchStudy = (s: StudyDef) => !needle || [s.title, s.blurb, s.detail, s.mateIn, s.id].some((v) => (v || "").toLowerCase().includes(needle));
  // Hardcoded cards live as JSX below; match them on any of their words.
  const HARDCODED_TEXT: Record<string, string> = {
    "promote-one-pawn": "Promote One Pawn pawn endings promotion rule square key squares floating exam",
    "opposition": "Opposition direct distant very distant Neustadtl Mattison Drtina Dvoretsky king",
    "rule-of-square": "Rule of the Square King Pawn catch tablebase double-step opposition key",
    "key-squares": "Key Squares king winning tap rook pawn",
  };
  const matchHardcoded = (id: keyof typeof HARDCODED_TEXT) => !needle || HARDCODED_TEXT[id].toLowerCase().includes(needle);
  // Split STUDIES by game-phase so the /study page reads like a chess curriculum
  // (Opening / Middle game / End game). Any entry lacking `phase` (utility
  // dashboards etc.) falls into `other` and renders in an "Other" bucket only
  // if any exist. Owner-requested taxonomy 2026-08-18.
  // Opening trainers live at /openings now — exclude them here.
  const memoryStudies  = STUDIES.filter((s) => s.phase === "memory"  && matchStudy(s));
  const middleStudies  = STUDIES.filter((s) => s.phase === "middle"  && matchStudy(s));
  const endStudies     = STUDIES.filter((s) => s.phase === "end"     && matchStudy(s));
  const otherStudies   = STUDIES.filter((s) => !s.phase && matchStudy(s));
  const anyHardcoded = matchHardcoded("promote-one-pawn") || matchHardcoded("opposition") || matchHardcoded("rule-of-square") || matchHardcoded("key-squares");
  const totalMatches = memoryStudies.length + middleStudies.length + endStudies.length + otherStudies.length + (needle ? [matchHardcoded("promote-one-pawn"), matchHardcoded("opposition"), matchHardcoded("rule-of-square"), matchHardcoded("key-squares")].filter(Boolean).length : 4);

  return (
    <div className="space-y-10">
      {/* Page header + search — spans all three phase sections below. */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Studies</div>
          <h1 className="font-display text-2xl text-white">Study by game phase</h1>
          <p className="text-sm text-ink-400">Every concept, sorted by where it applies in the game. The ★ chip shows each concept's curated difficulty range; a green "you: ~XXXX" appears once you've played enough for a personal estimate.</p>
        </div>
        <div className="shrink-0">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search studies…" className="w-64 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none" />
          {needle && (
            <div className="mt-1 text-right text-[11px] text-ink-500">{totalMatches} match{totalMatches === 1 ? "" : "es"}</div>
          )}
        </div>
      </header>

      {/* Opening trainers relocated to Learn → Openings (/openings) 2026-08-19 —
          no redirect banner here since the nav already surfaces the new home. */}

      {/* ── Memory training (standalone — general board memory tools) ──────── */}
      {memoryStudies.length > 0 && (
        <section className="space-y-6 border-t border-ink-800 pt-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-400">Memory training 🏰</div>
            <h2 className="font-display text-xl text-white">Board memory (Memory Palace)</h2>
            <p className="text-sm text-ink-400">Memory-champion technique for chess — give every square a funny picture, then never forget it.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {memoryStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
          </div>
        </section>
      )}

      {/* ── Middle game ─────────────────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-ink-800 pt-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">Middle game ⚔️</div>
          <h2 className="font-display text-xl text-white">Tactics, plans &amp; attacks</h2>
          <p className="text-sm text-ink-400">Middle-game trainers are on the roadmap — for now, drill patterns in the <Link to="/" className="text-brand-400 underline">Puzzle trainer</Link>.</p>
        </div>
        {middleStudies.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {middleStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
          </div>
        ) : (
          <div className="rounded-xl2 border border-dashed border-ink-700 bg-ink-900/50 p-6 text-center">
            <p className="text-sm text-ink-400">Coming soon — pin attacks, discovered attacks, forks, skewers, sacrifice patterns, king-safety drills.</p>
          </div>
        )}
      </section>

      {/* ── End game ────────────────────────────────────────────────────────── */}
      <section className="space-y-6 border-t border-ink-800 pt-8">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">End game 🏁</div>
          <h2 className="font-display text-xl text-white">Endgame technique &amp; mates</h2>
          <p className="text-sm text-ink-400">Guided lessons + rated drills. You play the winning side, Stockfish defends at full strength.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {matchHardcoded("promote-one-pawn") && (
          <Link to="/study/promote"
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">👑</span>
              <div>
                <h2 className="font-display text-lg text-white">Promote One Pawn</h2>
                <p className="text-xs text-ink-400">Guided course · start here</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">Six short chapters that teach pawn endings from zero — promotion, the rule of the square, key squares, draw-or-win verdicts, a play-it-out exam against a perfect defender, and the floating square: one king vs two pawns.</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Lesson course</span>
                <RangeChip range={[700, 1200]} />
              </div>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
          )}
          {matchHardcoded("opposition") && (
          <Link to="/study/opposition"
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">🤝</span>
              <div>
                <h2 className="font-display text-lg text-white">Opposition</h2>
                <p className="text-xs text-ink-400">Direct · distant · very distant</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">The kings' duel: whoever must move loses the argument. Four chapters — direct opposition, distant, very distant — and the book classics (Neustadtl, Mattison, Drtina, Dvoretsky's holds) played out on the board.</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Lesson course + books</span>
                <RangeChip range={[1000, 1500]} />
              </div>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
          )}
          {matchHardcoded("rule-of-square") && (
          <Link to="/study/endgame"
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">🏁</span>
              <div>
                <h2 className="font-display text-lg text-white">Rule of the Square</h2>
                <p className="text-xs text-ink-400">King + Pawn vs King</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">Can the king catch the pawn? Answer yes/no, see the square drawn as proof, then play it out against a perfect tablebase — the square, the double-step, opposition &amp; key squares.</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Q&amp;A + play-it-out</span>
                <RangeChip range={[500, 900]} />
              </div>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
          )}
          {matchHardcoded("key-squares") && (
          <Link to="/study/key-squares"
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">🔑</span>
              <div>
                <h2 className="font-display text-lg text-white">Key Squares</h2>
                <p className="text-xs text-ink-400">The king's winning squares</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">Tap every key square of the pawn — the squares where the king promotes it no matter whose move it is. Rook pawns are the trick: they have none. Separate rating, matched to your level.</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Tap-the-squares</span>
                <RangeChip range={[1100, 1500]} />
              </div>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
          )}
          {endStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
        </div>
        <p className="text-xs text-ink-500">More endgame studies coming — triangulation, corresponding squares…</p>
      </section>

      {/* ── Other (utility/dashboard entries lacking a phase) ───────────────── */}
      {otherStudies.length > 0 && (
        <section className="space-y-6 border-t border-ink-800 pt-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Other</div>
            <h2 className="font-display text-xl text-white">Utilities &amp; tools</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {otherStudies.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
          </div>
        </section>
      )}
    </div>
  );
}
