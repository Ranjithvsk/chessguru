import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { THEMES, themeById, DEFAULT_THEME_ID } from "../lib/memoryPalace";
import { buildSteps, anchorFor, composeLineStory, OPENING_PRESETS, OPENING_HANDOFF_KEY, type OpeningHandoff } from "../lib/openingMemory";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const OPENING_LAST_PICK_KEY = "cg_opening_memory_last";

export default function OpeningMemory() {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const scenes = themeById(themeId).scenes;

  // an explored line handed over from the Opening tab (consumed once), else a preset
  const handoff = useMemo<OpeningHandoff | null>(() => {
    try { const raw = sessionStorage.getItem(OPENING_HANDOFF_KEY); if (raw) { const h = JSON.parse(raw) as OpeningHandoff; if (h?.sans?.length) return h; } } catch { /* */ }
    return null;
  }, []);
  useEffect(() => { try { sessionStorage.removeItem(OPENING_HANDOFF_KEY); } catch { /* */ } }, []);

  // Priority: fresh handoff > last pick in localStorage > Italian (first preset).
  const [line, setLine] = useState<{ name: string; sans: string[] }>(() => {
    if (handoff) return { name: handoff.name, sans: handoff.sans };
    try {
      const raw = localStorage.getItem(OPENING_LAST_PICK_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { name: string; sans: string[] };
        if (p?.sans?.length) return p;
      }
    } catch { /* fall through */ }
    return { name: OPENING_PRESETS[0]!.name, sans: OPENING_PRESETS[0]!.sans };
  });
  // Persist every change (handoff, preset click) so refresh restores the last pick.
  useEffect(() => {
    try { localStorage.setItem(OPENING_LAST_PICK_KEY, JSON.stringify(line)); } catch { /* */ }
  }, [line]);

  const steps = useMemo(() => buildSteps(line.sans), [line]);
  const [ply, setPly] = useState(0); // 0 = starting position
  useEffect(() => setPly(0), [line]);

  const cur = ply > 0 ? steps[ply - 1]! : null;
  const fen = cur ? cur.fen : START_FEN;
  const lastMove: [Key, Key] | undefined = cur ? [cur.from as Key, cur.to as Key] : undefined;
  const anchor = cur ? anchorFor(cur, scenes) : null;
  const atEnd = ply >= steps.length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Link to="/study" className="text-sm text-ink-400 hover:text-white">&larr; All studies</Link>
        <span className="text-xs font-medium text-ink-500">Opening Memory · anchors</span>
      </div>

      <div>
        <h1 className="font-display text-2xl text-white">♟️ Opening Memory</h1>
        <p className="text-sm text-ink-400">Learn an opening like a <b className="text-ink-200">story</b>: every move is a hero visiting a square's funny picture (its <b className="text-ink-200">anchor</b>). Step through and say each line out loud.</p>
      </div>

      {/* which opening */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">Opening</div>
        <div className="flex flex-wrap gap-1.5">
          {handoff && (
            <button onClick={() => setLine({ name: handoff.name, sans: handoff.sans })}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${line.name === handoff.name ? "bg-accent-600 text-white" : "border border-accent-700 text-accent-300 hover:bg-ink-800"}`}>
              🧭 {handoff.name}
            </button>
          )}
          {OPENING_PRESETS.map((p) => (
            <button key={p.id} onClick={() => setLine({ name: p.name, sans: p.sans })}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${line.name === p.name ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* level + picture set */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">Level (L1 = easiest / L5 = most varied)</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[1, 5].map((L) => {
            const active = themeById(themeId).level === L;
            return (
              <button key={L} onClick={() => {
                const base = themeId.replace(/-l\d$/, "");
                const next = `${base}-l${L}`;
                setThemeId(THEMES.find(t => t.id === next)?.id ?? THEMES.find(t => t.level === L)!.id);
              }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${active ? "bg-amber-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                Level {L}
              </button>
            );
          })}
        </div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">Picture set (anchors)</div>
        <div className="flex flex-wrap gap-1.5">
          {THEMES.filter((t) => t.level === themeById(themeId).level).map((t) => (
            <button key={t.id} onClick={() => setThemeId(t.id)} title={t.blurb}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${themeId === t.id ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>

      <Board fen={fen} orientation="white" coordinates viewOnly movableColor={undefined} dests={new Map()} lastMove={lastMove} />

      {/* stepper */}
      <div className="flex items-center gap-2">
        <button onClick={() => setPly(0)} disabled={ply === 0} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40">|◀</button>
        <button onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40">◀ Back</button>
        <div className="flex-1 text-center text-sm text-ink-400">Move {ply} / {steps.length}</div>
        <button onClick={() => setPly((p) => Math.min(steps.length, p + 1))} disabled={atEnd} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40">Next ▶</button>
        <button onClick={() => setPly(steps.length)} disabled={atEnd} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 disabled:opacity-40">▶|</button>
      </div>

      {/* anchor card */}
      {anchor && cur ? (
        <div className="rounded-xl2 border border-brand-700/60 bg-ink-900 p-4">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none">{anchor.glyph}</span>
            <div>
              <div className="font-display text-lg font-bold text-white">{cur.color === "w" ? "White" : "Black"} plays <span className="text-brand-300">{cur.san}</span></div>
              <div className="text-[11px] uppercase tracking-wide text-ink-500">anchor square {cur.to}</div>
            </div>
            <span className="ml-auto text-4xl">{anchor.scene.emoji}</span>
          </div>
          <p className="mt-3 text-base font-semibold leading-relaxed text-white">“{anchor.sentence}”</p>
          <p className="mt-1 text-sm text-ink-400"><b className="text-ink-300">{anchor.scene.pair}</b> — {anchor.scene.scene}</p>
          {/* AI single-move illustration (only if move-<ply>.png exists for this opening slug) */}
          <MoveImage slug={OPENING_PRESETS.find((p) => p.name === line.name)?.id ?? null} ply={ply} />
        </div>
      ) : (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-center text-sm text-ink-400">
          {atEnd && steps.length > 0 ? "🎉 That's the whole opening — now tell it back as one story!" : "Press Next ▶ to start the story."}
        </div>
      )}

      {/* One combined story — its own card so it can breathe */}
      {steps.length > 0 && (
        <div className="rounded-xl2 border border-brand-700/50 bg-brand-900/25 p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-300">
            <span>📖</span>
            <span>One combined story</span>
            <span className="text-ink-500">— read it out loud once, top to bottom</span>
          </div>
          <div className="space-y-2 text-base leading-8 text-ink-100">
            {composeLineStory(steps, scenes).split(/(?<=\.)\s+/).map((sentence, i) => (
              <p key={i}>{sentence}</p>
            ))}
          </div>
        </div>
      )}

      {/* full move list with anchors */}
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-2">
        <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-ink-500">The whole line</div>
        <div className="divide-y divide-ink-800/70">
          {steps.map((st, i) => {
            const a = anchorFor(st, scenes);
            const active = i + 1 === ply;
            const num = st.color === "w" ? `${Math.ceil((i + 1) / 2)}.` : `${Math.ceil((i + 1) / 2)}…`;
            return (
              <button key={i} onClick={() => setPly(i + 1)}
                className={`grid w-full grid-cols-[2.2rem_3rem_1fr] items-center gap-2 px-2 py-2 text-left ${active ? "bg-brand-600/15" : "hover:bg-ink-800"}`}>
                <span className="text-xs text-ink-500">{num}</span>
                <span className="font-semibold text-white">{st.san}</span>
                <span className="truncate text-xs text-ink-400">{a.scene.emoji} {a.character} → {a.scene.pair}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Single-move illustration for the currently-viewed ply. Hides itself if
 *  /openings/<slug>/move-<ply>.png doesn't exist. */
function MoveImage({ slug, ply }: { slug: string | null; ply: number }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [slug, ply]);
  if (!slug || !ok || ply < 1) return null;
  const src = `${import.meta.env.BASE_URL}openings/${slug}/move-${ply}.png`;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-brand-800/60">
      <img src={src} alt={`move ${ply} illustration`}
        onError={() => setOk(false)}
        className="block w-full" />
    </div>
  );
}

