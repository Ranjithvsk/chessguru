// Key Squares trainer — a SEPARATE study module (rating type "keysq") with a
// different question from the Rule-of-the-Square trainer: instead of Yes/No, you
// TAP every key square of the pawn (the squares where the attacking king queens it
// regardless of the move). Rook pawns are trick positions — there are none. The
// correct set is computed by the exact KPK oracle; a separate Glicko rating tracks
// your skill and suggests positions at your level.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "chessground/types";
import type { DrawShape } from "chessground/draw";
import Board from "../components/Board";
import { ensureOracle, keySquares, type KeySquares } from "../lib/endgame/oracle";
import { studyPuzzle, studyMe, studyComplete } from "../lib/api";

const STUDY_TYPE = "keysq";
const FILES = "abcdefgh";
const setEq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

type Phase = "loading" | "solving" | "revealed";

export default function KeySquaresTrainer() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [fen, setFen] = useState("");
  const [keys, setKeys] = useState<KeySquares | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");

  const [rating, setRating] = useState(1200);
  const ratingRef = useRef(1200);
  const [guest, setGuest] = useState(true);
  const [delta, setDelta] = useState<number | null>(null);
  const [pzRating, setPzRating] = useState<number | null>(null);
  const [solved, setSolved] = useState(0);
  const serverId = useRef<string | null>(null);
  const scored = useRef(false);

  const loadNext = useCallback(async () => {
    setDelta(null); setSelected(new Set()); setCorrect(null); setMsg("");
    let ff = "", id: string | null = null, pr: number | null = null;
    try {
      const sp = await studyPuzzle(STUDY_TYPE, ratingRef.current);
      if (sp) { ff = sp.fen; id = sp.id; pr = sp.rating; }
    } catch { /* offline */ }
    if (!ff) { setMsg("Couldn't reach the key-squares set."); return; }
    serverId.current = id; scored.current = false;
    setFen(ff); setKeys(keySquares(ff)); setPzRating(pr);
    setPhase("solving");
  }, []);

  useEffect(() => {
    let alive = true;
    ensureOracle().then(async () => {
      if (!alive) return;
      try { const me = await studyMe(STUDY_TYPE); if (alive) { setRating(me.rating); ratingRef.current = me.rating; setGuest(me.guest); } } catch { /* */ }
      setReady(true); await loadNext();
    }).catch(() => setMsg("Couldn't load the endgame tablebase."));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((sqName: string) => {
    if (phase !== "solving") return;
    setSelected((prev) => { const n = new Set(prev); if (n.has(sqName)) n.delete(sqName); else n.add(sqName); return n; });
  }, [phase]);

  const scoreOnce = useCallback(async (win: boolean) => {
    if (scored.current) return; scored.current = true;
    const id = serverId.current; if (!id) return;
    try {
      const res = await studyComplete(id, win, ratingRef.current);
      setRating(res.rating); ratingRef.current = res.rating; setDelta(res.ratingDiff);
    } catch { /* best-effort */ }
  }, []);

  const check = useCallback((assertNone = false) => {
    if (!keys || phase !== "solving") return;
    const sel = assertNone ? new Set<string>() : selected;
    if (assertNone) setSelected(new Set());
    const win = setEq(sel, keys.squares);
    setCorrect(win); setSolved((n) => n + 1);
    void scoreOnce(win);
    setMsg(win
      ? (keys.rookPawn ? "Correct — a rook's pawn has no key squares. 🛡️" : "Correct — all key squares found! 🎯")
      : (keys.rookPawn ? "Not quite — this is a rook's pawn: there are NO key squares." : "Not quite — see the full set below."));
    setPhase("revealed");
  }, [keys, phase, selected, scoreOnce]);

  // ── overlay shapes ──
  const shapes: DrawShape[] = useMemo(() => {
    if (!keys) return [];
    if (phase === "solving") {
      // show the user's current picks as blue circles
      return [...selected].map((s) => ({ orig: s as Key, brush: "blue" }));
    }
    // revealed: grade with colour — green hit, red wrong pick, purple missed
    const s: DrawShape[] = [];
    const corr = new Set(keys.squares);
    for (const k of keys.squares) s.push({ orig: k as Key, brush: selected.has(k) ? "green" : "purple" });
    for (const k of selected) if (!corr.has(k)) s.push({ orig: k as Key, brush: "red" });
    return s;
  }, [keys, phase, selected]);

  // 8×8 click overlay, white orientation: row0=rank8, col0=file a
  const overlay = useMemo(() => Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8), col = i % 8;
    return FILES[col]! + (8 - row);
  }), []);

  if (!ready) return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="text-lg font-semibold text-ink-200">Preparing the endgame tablebase…</div>
      <div className="mt-2 text-sm text-ink-400">Computing every King + Pawn vs King position (once — then it's cached & offline).</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">🔑 Key squares · endgame trainer</h1>
          <p className="mt-1 text-sm text-ink-400">Tap the squares where the king queens the pawn — no matter whose move it is.</p>
        </div>
        <div className="text-right text-sm text-ink-300">
          <div className="flex items-center justify-end gap-1.5">
            <span>Key-squares rating:</span>
            <b className="text-white">{rating}</b>
            {delta !== null && <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>{delta >= 0 ? `+${delta}` : delta}</span>}
          </div>
          <div className="text-ink-400">Solved: {solved}{guest ? " · sign in to save your rating" : ""}</div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative cg-board-host">
          <Board fen={fen} orientation="white" viewOnly shapes={shapes} coordinates />
          {phase === "solving" && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
              <div
                className="pointer-events-auto grid aspect-square w-full grid-cols-8 grid-rows-8"
                style={{ maxWidth: "min(100%, calc(100dvh - 10.5rem))" }}
              >
                {overlay.map((sq) => (
                  <button
                    key={sq}
                    onClick={() => toggle(sq!)}
                    aria-label={sq}
                    className={`h-full w-full transition ${selected.has(sq!) ? "bg-sky-400/25 shadow-[inset_0_0_0_3px_rgba(56,189,248,0.9)]" : "hover:bg-white/10"}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          {phase === "solving" && keys && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-ink-500">Key squares</div>
                {pzRating !== null && <span className="rounded-full bg-ink-800 px-2 py-0.5 text-xs font-semibold text-ink-200" title="Matched to your key-squares rating (±175)">Rated {pzRating}</span>}
              </div>
              <div className="mt-1 text-lg font-semibold text-white">Tap every key square for {keys.attacker}'s pawn.</div>
              <p className="mt-1 text-xs text-ink-500">The squares where the {keys.attacker} king promotes the pawn regardless of whose move it is. Some pawns have none.</p>
              <div className="mt-2 text-sm text-ink-300">Selected: <b className="text-sky-300">{selected.size}</b></div>
              <div className="mt-4 flex flex-col gap-2">
                <button onClick={() => check(false)} className="rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Check</button>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(new Set())} className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Clear</button>
                  <button onClick={() => check(true)} className="flex-1 rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800" title="Claim this pawn has no key squares (rook pawn)">No key squares</button>
                </div>
              </div>
            </div>
          )}

          {phase === "revealed" && keys && (
            <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
              <div className={`text-lg font-bold ${correct ? "text-emerald-400" : "text-rose-400"}`}>{msg}</div>
              <p className="mt-2 text-sm text-ink-300">{keys.text}</p>
              <div className="mt-2 text-xs text-ink-500">
                <span className="text-emerald-400">Green</span> = you found it · <span className="text-violet-300">violet</span> = missed key square · <span className="text-rose-400">red</span> = not a key square.
              </div>
              <button onClick={() => loadNext()} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-bold text-white hover:bg-brand-500">Next position ↻</button>
            </div>
          )}

          <div className="rounded-xl border border-ink-800 bg-ink-950/40 p-3 text-xs leading-relaxed text-ink-400">
            <b className="text-ink-200">The rule:</b> for a non-rook pawn, the key squares sit two ranks ahead (three of them), and once the pawn reaches the 5th–6th rank the rank just in front joins too (six). A rook's pawn has none — the defender draws in the corner.
          </div>
        </aside>
      </div>
    </div>
  );
}
