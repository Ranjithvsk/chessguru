import { Link } from "react-router-dom";
import { STUDIES } from "../lib/studies";

export default function StudyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl text-white">Studies</h1>
        <p className="text-sm text-ink-400">Endgame technique trainers — you play the winning side, Stockfish defends at full strength.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {STUDIES.map((s) => (
          <Link key={s.id} to={`/study/${s.id}`}
            className="group flex flex-col rounded-xl2 border border-ink-700 bg-ink-900 p-5 transition hover:border-brand-500 hover:bg-ink-800">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-brand-gradient text-3xl text-white">{s.icon}</span>
              <div>
                <h2 className="font-display text-lg text-white">{s.title}</h2>
                <p className="text-xs text-ink-400">{s.blurb}</p>
              </div>
            </div>
            <p className="mt-3 flex-1 text-sm text-ink-400">{s.detail}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="rounded-full bg-ink-800 px-2.5 py-1 text-[11px] font-medium text-ink-300">{s.mateIn}</span>
              <span className="text-sm font-semibold text-brand-400 group-hover:text-brand-300">Start →</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-ink-500">More studies coming — two-bishop mate, king &amp; pawn, opposition…</p>
    </div>
  );
}
