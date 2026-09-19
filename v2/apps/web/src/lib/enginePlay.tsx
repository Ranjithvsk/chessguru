// Shared "play it out" machinery for the endgame lesson pages (Triangulation, Zugzwang) — the
// same three options the study trainer has (owner 2026-09-19: "add the same to triangulation and
// zugzwang"): the engine defends (Easy / Medium / Hard), or the student plays both sides, and
// every student move is judged (each move / at the end / off) by the exact tablebase for ≤5
// pieces or Stockfish 18 beyond that. Drives a SharedClassBoard in local mode: feed every
// onLocalChange to `handleLocalChange`; engine replies go back through triggerClassPlayMove at
// the node the student played from, so variations get answers too.
import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createEngine, type Engine } from "./engine";
import { studyAdvise, studyDefend, type AdviceReply } from "./api";
import { triggerClassBoardAction, triggerClassFlipOrientation, triggerClassPlayMove, triggerClassSeek, useClassCursorInfo } from "../components/SharedClassBoard";
import type { LocalRoomState, LocalTreeNode } from "./localClassRoom";

export type DefenceLevel = "easy" | "medium" | "hard";
export type PlayMode = "engine" | "both";
export type AdviceMode = "move" | "end" | "off";
// Same storage keys as StudyTrainer so a choice carries across every study page.
const DEFENCE_KEY = "cg_study_defence_v2";
const MODE_KEY = "cg_study_mode";
// Advice keeps its own key on the lesson pages so a "each move" choice made in the trainer does not
// leak here — lessons default to "at the end" (owner 2026-09-19).
const ADVICE_KEY = "cg_lesson_advice";
export const DEFENCE_LABEL: Record<DefenceLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
export type AdviceRow = { n: number; side: "w" | "b"; san: string; verdict: NonNullable<AdviceReply["verdict"]>; why: string | null; best: string; line: string[] };
export const VERDICT_TONE: Record<AdviceRow["verdict"], string> = { best: "text-emerald-300", inaccuracy: "text-amber-300", mistake: "text-orange-400", blunder: "text-rose-400" };
export const VERDICT_MARK: Record<AdviceRow["verdict"], string> = { best: "✓", inaccuracy: "?!", mistake: "?", blunder: "??" };

function nodeAt(tree: LocalTreeNode[], path: number[]): LocalTreeNode | null {
  let nodes: LocalTreeNode[] = tree; let node: LocalTreeNode | null = null;
  for (const i of path) { node = nodes[i] ?? null; if (!node) return null; nodes = node.children; }
  return node;
}
function fenAt(startFen: string, tree: LocalTreeNode[], path: number[]): string {
  const c = new Chess(startFen); let nodes: LocalTreeNode[] = tree;
  for (const i of path) { const n = nodes[i]; if (!n) break; try { c.move({ from: n.move.from, to: n.move.to, promotion: (n.move.promotion as "q" | "r" | "b" | "n" | undefined) ?? undefined }); } catch { break; } nodes = n.children; }
  return c.fen();
}
const uciOf = (m: { from: string; to: string; promotion?: string }) => `${m.from}${m.to}${m.promotion ?? ""}`;
function readLs<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key); return (ok as readonly string[]).includes(v ?? "") ? (v as T) : fallback; } catch { return fallback; }
}

export interface EnginePlay {
  mode: PlayMode; setMode: (m: PlayMode) => void;
  level: DefenceLevel; setLevel: (l: DefenceLevel) => void;
  adviceMode: AdviceMode; setAdviceMode: (a: AdviceMode) => void;
  thinking: boolean; status: string; note: string | null; over: string | null;
  advice: AdviceRow | null; adviceLog: AdviceRow[];
  handleLocalChange: (st: LocalRoomState) => void;
  reset: () => void;
}

/** userColor = the side the student takes when "vs engine" (the side to move in the lesson position). */
export function useEnginePlay(userColor: "w" | "b"): EnginePlay {
  const [mode, setModeState] = useState<PlayMode>(() => readLs(MODE_KEY, ["engine", "both"] as const, "engine"));
  const [level, setLevelState] = useState<DefenceLevel>(() => readLs(DEFENCE_KEY, ["easy", "medium", "hard"] as const, "hard"));
  const [adviceMode, setAdviceModeState] = useState<AdviceMode>(() => readLs(ADVICE_KEY, ["move", "end", "off"] as const, "end"));
  const modeRef = useRef(mode); modeRef.current = mode;
  const levelRef = useRef(level); levelRef.current = level;
  const adviceRef = useRef(adviceMode); adviceRef.current = adviceMode;
  const userRef = useRef(userColor); userRef.current = userColor;
  const setMode = (m: PlayMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* */ } };
  const setLevel = (l: DefenceLevel) => { setLevelState(l); try { localStorage.setItem(DEFENCE_KEY, l); } catch { /* */ } };
  const setAdviceMode = (a: AdviceMode) => { setAdviceModeState(a); try { localStorage.setItem(ADVICE_KEY, a); } catch { /* */ } };

  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState("Your move.");
  const [note, setNote] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [advice, setAdvice] = useState<AdviceRow | null>(null);
  const [adviceLog, setAdviceLog] = useState<AdviceRow[]>([]);
  const logRef = useRef<AdviceRow[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const injectedRef = useRef<string | null>(null);
  const mateTargetRef = useRef<number | null>(null);
  const engineRef = useRef<Engine | null>(null);
  useEffect(() => () => { engineRef.current?.quit(); engineRef.current = null; }, []);
  const browser = async (fen: string, skill: number, ms: number) => {
    try {
      if (!engineRef.current) { engineRef.current = createEngine(); await engineRef.current.ready; }
      engineRef.current.setOption("Skill Level", skill);
      return await engineRef.current.bestMove(fen, ms);
    } catch { return ""; }
  };

  const reset = useCallback(() => {
    seenRef.current = new Set(); injectedRef.current = null; mateTargetRef.current = null; logRef.current = [];
    setThinking(false); setStatus("Your move."); setNote(null); setOver(null); setAdvice(null); setAdviceLog([]);
  }, []);

  const judge = (fenBefore: string, uci: string, san: string, n: number, side: "w" | "b") => {
    if (adviceRef.current === "off") return;
    studyAdvise(fenBefore, uci).then((r) => {
      if (!r?.ok || !r.verdict) return;
      const row: AdviceRow = { n, side, san, verdict: r.verdict, why: r.why ?? null, best: r.best ?? "", line: r.bestLine ?? [] };
      logRef.current = [...logRef.current, row]; setAdviceLog(logRef.current);
      if (adviceRef.current === "move") setAdvice(row);
    }).catch(() => { /* offline */ });
  };

  const endText = (c: Chess): string | null => {
    if (c.isCheckmate()) return `Checkmate — ${c.turn() === "w" ? "Black" : "White"} wins.`;
    if (c.isStalemate()) return "Stalemate — draw.";
    if (c.isInsufficientMaterial()) return "Draw — not enough material.";
    if (c.isDraw()) return "Draw.";
    return null;
  };

  const handleLocalChange = useCallback(async (st: LocalRoomState) => {
    let game: Chess; try { game = new Chess(st.fen); } catch { return; }
    const path = st.cursorPath; const node = nodeAt(st.tree, path);
    if (!node) { setAdvice(null); setOver(null); return; }
    const key = `${path.join(".")}:${uciOf(node.move)}`;
    if (seenRef.current.has(key)) return;                       // seek / step — not a new move
    seenRef.current.add(key);
    const uci = uciOf(node.move);
    const done = endText(game); setOver(done);
    if (injectedRef.current === uci) {                          // the engine's reply landed
      injectedRef.current = null; setThinking(false);
      if (!done) setStatus("Your move.");
      return;
    }
    const fenBefore = fenAt(st.startFen, st.tree, path.slice(0, -1));
    let san = uci; let mover: "w" | "b" = "w";
    try { const c = new Chess(fenBefore); mover = c.turn(); const m = c.move({ from: node.move.from, to: node.move.to, promotion: (node.move.promotion as "q" | undefined) ?? "q" }); san = m?.san ?? uci; } catch { /* */ }
    setAdvice(null);
    judge(fenBefore, uci, san, Math.ceil(path.length / 2), mover);
    if (done) return;
    if (modeRef.current === "both") {
      setStatus(`${game.turn() === "w" ? "White" : "Black"} to move — you play both sides.`); setNote(null);
      const snap = game.fen();
      try {
        const r = await Promise.race([studyDefend(snap, "hard"), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), 2500))]);
        if (r?.ok && typeof r.mateIn === "number" && typeof r.wdl === "number") {
          const winner = (r.wdl > 0) === (game.turn() === "w") ? "White" : "Black";
          setNote(`tablebase · ${winner} mates in ${r.mateIn} with best play`);
        } else if (r?.ok && r.wdl === 0) setNote("tablebase · drawn with best play");
      } catch { /* offline */ }
      return;
    }
    if (game.turn() === userRef.current) return;                // the student moved for the other side — no reply
    const lvl = levelRef.current;
    setThinking(true); setStatus(lvl === "easy" ? "Defending… (Easy)" : lvl === "medium" ? "Stockfish 18 is defending… (Medium)" : "Best defence… (Hard)"); setNote(null);
    const replyFen = game.fen();
    let best = ""; let n: string | null = null;
    if (lvl === "easy") best = await browser(replyFen, 3, 150);
    else {
      try {
        const r = await Promise.race([studyDefend(replyFen, lvl), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), 3000))]);
        if (r?.ok && r.move) {
          best = r.move;
          if (typeof r.mateIn === "number") {
            n = `${r.source === "oracle" ? "tablebase" : "Stockfish 18"} · mate in ${r.mateIn} with best play`;
            const target = mateTargetRef.current;
            if (target != null && r.source === "oracle") n += r.mateIn <= target - 1 ? " · ✓ best move" : ` · you gave away ${r.mateIn - target + 1} ${r.mateIn - target + 1 === 1 ? "tempo" : "tempi"} (mate in ${target - 1} was there)`;
            mateTargetRef.current = r.source === "oracle" ? r.mateIn : null;
          } else if (r?.ok && r.wdl === 0) { n = "tablebase · drawn with best play"; mateTargetRef.current = null; }
          else { n = r.source === "oracle" ? "tablebase defence" : "Stockfish 18 (server)"; mateTargetRef.current = null; }
        }
      } catch { /* offline / slow */ }
      if (!best) { best = await browser(replyFen, 20, 600); n = "browser Stockfish"; mateTargetRef.current = null; }
    }
    if (best && best !== "(none)" && best.length >= 4) {
      injectedRef.current = best; setNote(n);
      triggerClassPlayMove({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] || undefined });
      setTimeout(() => { if (injectedRef.current === best) { injectedRef.current = null; setThinking(false); } }, 4000);
    } else { setThinking(false); setStatus("Your move."); }
  }, []);

  return { mode, setMode, level, setLevel, adviceMode, setAdviceMode, thinking, status, note, over, advice, adviceLog, handleLocalChange, reset };
}

/** The chips + status + advice cards. Drop it under the board of any lesson page. */
export function EnginePlayControls({ play }: { play: EnginePlay }) {
  const [review, setReview] = useState(false);
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`;
  const mistakes = play.adviceLog.filter((a) => a.verdict !== "best");
  const showList = play.adviceMode === "end" && (review || !!play.over) && play.adviceLog.length > 0;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3 text-sm">
      <div className={`font-semibold ${play.over ? "text-accent-400" : play.thinking ? "text-gold-400" : "text-ink-200"}`}>{play.over ?? play.status}</div>
      {play.note && <div className="mt-0.5 text-xs text-ink-500">{play.note}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-500">Play</span>
        <button type="button" className={chip(play.mode === "engine")} onClick={() => play.setMode("engine")} disabled={play.thinking} title="You play the side to move; the engine answers">vs engine</button>
        <button type="button" className={chip(play.mode === "both")} onClick={() => play.setMode("both")} disabled={play.thinking} title="You move both colours; the tablebase still counts the mate">both sides</button>
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-1.5 ${play.mode === "both" ? "opacity-40" : ""}`}>
        <span className="mr-1 text-xs text-ink-500">Defence</span>
        {(["easy", "medium", "hard"] as DefenceLevel[]).map((v) => (
          <button key={v} type="button" className={chip(play.level === v)} onClick={() => play.setLevel(v)} disabled={play.thinking || play.mode === "both"}
            title={v === "easy" ? "Browser Stockfish, makes small mistakes" : v === "medium" ? "Stockfish 18 + tablebases — near-perfect" : "Exact tablebase — never gives a move away"}>{DEFENCE_LABEL[v]}</button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-500">Advice</span>
        {(["move", "end", "off"] as AdviceMode[]).map((v) => (
          <button key={v} type="button" className={chip(play.adviceMode === v)} onClick={() => play.setAdviceMode(v)}
            title={v === "move" ? "Judge every move as you play, with the reason" : v === "end" ? "Play through, then review every move with reasons" : "No advice"}>{v === "move" ? "each move" : v === "end" ? "at the end" : "off"}</button>
        ))}
        {play.adviceMode === "end" && play.adviceLog.length > 0 && !play.over && (
          <button type="button" className="ml-auto rounded-lg border border-ink-600 px-2.5 py-1 text-xs text-ink-300 hover:bg-ink-800" onClick={() => setReview((r) => !r)}>{review ? "Hide review" : `Review ${play.adviceLog.length} move${play.adviceLog.length === 1 ? "" : "s"}`}</button>
        )}
      </div>
      {play.adviceMode === "move" && play.advice && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/60 p-3">
          <div className={`font-semibold ${VERDICT_TONE[play.advice.verdict]}`}>{play.advice.san}{VERDICT_MARK[play.advice.verdict]} — {play.advice.verdict === "best" ? "best move" : play.advice.verdict}</div>
          {play.advice.why && <div className="mt-1 text-xs text-ink-300">{play.advice.why}</div>}
          {play.advice.verdict !== "best" && play.advice.line.length > 0 && <div className="mt-1 text-xs text-ink-500">Best: {play.advice.line.join(" ")}</div>}
        </div>
      )}
      {showList && (
        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/60 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Your moves · {mistakes.length} to look at</div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {mistakes.map((a, i) => (
              <div key={i} className="text-xs">
                <span className={`font-semibold ${VERDICT_TONE[a.verdict]}`}>{a.n}{a.side === "w" ? "." : "…"} {a.san}{VERDICT_MARK[a.verdict]}</span>
                {a.why && <span className="text-ink-300"> — {a.why}</span>}
                {a.line.length > 0 && <span className="text-ink-500"> Best: {a.line.join(" ")}</span>}
              </div>
            ))}
            {mistakes.length === 0 && <div className="text-xs text-emerald-300">Every move was the best move. 🎯</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Start / back / forward / flip under a SharedClassBoard. */
export function BoardChrome() {
  const { cursorIdx, historyLen } = useClassCursorInfo();
  const btn = "rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-1.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <button type="button" className={btn} title="Start position" onClick={() => triggerClassSeek(0)} disabled={cursorIdx === 0}>⏮</button>
      <button type="button" className={btn} title="Previous move" onClick={() => triggerClassBoardAction("stepBack")} disabled={cursorIdx === 0}>◀</button>
      <span className="px-1 font-mono text-xs text-ink-400">{cursorIdx} / {historyLen}</span>
      <button type="button" className={btn} title="Next move" onClick={() => triggerClassBoardAction("stepForward")}>▶</button>
      <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden />
      <button type="button" className={btn} title="Flip board" onClick={() => triggerClassFlipOrientation()}>🔄 Flip</button>
      <span className="ml-auto text-[11px] text-ink-500">Step back and play another move to open a variation.</span>
    </div>
  );
}
