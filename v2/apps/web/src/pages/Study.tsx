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
          {level && level.n > 0 && (
            <span className="rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-300"
              title={`${level.n} rated puzzles · ${level.min}–${level.max}`}>
              ★ ~{level.avg} · {tier(level.avg)}
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
  useEffect(() => { studyLevels().then(setLevels).catch(() => { /* ratings optional */ }); }, []);

  const memory = STUDIES.filter((s) => s.kind === "memory");
  const rest = STUDIES.filter((s) => s.kind !== "memory");

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Part 1</div>
          <h1 className="font-display text-2xl text-white">Studies</h1>
          <p className="text-sm text-ink-400">Endgame technique trainers — you play the winning side, Stockfish defends at full strength. The ★ rating is each drills difficulty (calibrated from play).</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/study/promote"
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-2xl leading-none text-white">👑</span>
              <div>
                <h2 className="font-display text-lg text-white">Promote One Pawn</h2>
                <p className="text-xs text-ink-400">Guided course · start here</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">Five short chapters that teach the whole K+P vs K endgame from zero — promotion, the rule of the square, key squares, draw-or-win verdicts, then a final play-it-out exam against a perfect defender.</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Lesson course</span>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
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
              <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Q&amp;A + play-it-out</span>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
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
              <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">Tap-the-squares</span>
              <span className="shrink-0 text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
          {rest.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
        </div>
        <p className="text-xs text-ink-500">More studies coming — opposition, triangulation…</p>
      </section>

      {memory.length > 0 && (
        <section className="space-y-6 border-t border-ink-800 pt-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-400">Part 2</div>
            <h1 className="font-display text-2xl text-white">Memory Training 🏰</h1>
            <p className="text-sm text-ink-400">Memory-champion technique for chess — give every square a funny picture, then never forget it.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {memory.map((s) => <StudyCard key={s.id} s={s} level={levels[s.id]} />)}
          </div>
        </section>
      )}
    </div>
  );
}
