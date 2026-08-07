import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DrawShape } from "chessground/draw";
import Board from "../components/Board";
import { THEMES, themeById, DEFAULT_THEME_ID, ALL_SQUARES, WHITE_ARMY, BLACK_ARMY, isLightSquare, type PieceChar, type Scene } from "../lib/memoryPalace";

const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";
const FILES = "abcdefgh".split("");
const rand = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(a: T[]): T[] { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = rand(i + 1); [r[i], r[j]] = [r[j]!, r[i]!]; } return r; }

// viewOnly chessground boards fire no select events — derive the square from the click point.
function squareFromPoint(x: number, y: number): string | null {
  const el = document.querySelector("cg-board");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
  const cell = r.width / 8;
  const col = Math.max(0, Math.min(7, Math.floor((x - r.left) / cell)));
  const row = Math.max(0, Math.min(7, Math.floor((y - r.top) / cell)));
  return FILES[col]! + (8 - row); // orientation is always white here
}

type Mode = "explore" | "quiz";
type Dir = "find-scene" | "find-square";
type Question = { answer: string; options: string[] };

function newQuestion(dir: Dir): Question {
  const answer = ALL_SQUARES[rand(ALL_SQUARES.length)]!;
  if (dir === "find-square") return { answer, options: [] };
  const set = new Set<string>([answer]);
  while (set.size < 4) set.add(ALL_SQUARES[rand(ALL_SQUARES.length)]!);
  return { answer, options: shuffle([...set]) };
}

function SceneCard({ sq, big, scenes }: { sq: string; big?: boolean; scenes: Record<string, Scene> }) {
  const s = scenes[sq]!;
  return (
    <div className={`rounded-xl2 border border-ink-700 bg-ink-900 p-4 ${big ? "text-center" : ""}`}>
      <div className={`flex items-center gap-3 ${big ? "flex-col" : ""}`}>
        <span className={big ? "text-6xl" : "text-4xl"}>{s.emoji}</span>
        <div>
          <div className="font-display text-xl font-bold text-white">{s.pair}</div>
          <div className="text-[11px] uppercase tracking-wide text-brand-400">square {sq}</div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-300">{s.scene}</p>
    </div>
  );
}

function PieceRow({ p }: { p: PieceChar }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-ink-900 px-3 py-2">
      <span className="text-3xl leading-none">{p.glyph}</span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{p.name} <span className="text-ink-500">· {p.role}</span></div>
        <div className="text-xs text-ink-400">{p.feature}</div>
        <div className="text-xs text-accent-400">{p.sound}</div>
      </div>
    </div>
  );
}

export default function MemoryPalace() {
  const [mode, setMode] = useState<Mode>("explore");
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const theme = themeById(themeId);
  const scenes = theme.scenes;

  // explore
  const [selected, setSelected] = useState<string>("a1");
  const [showMap, setShowMap] = useState(false);
  const [showCast, setShowCast] = useState(false);
  const [coords, setCoords] = useState(true);

  // quiz
  const [dir, setDir] = useState<Dir>("find-scene");
  const [question, setQuestion] = useState<Question>(() => newQuestion("find-scene"));
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<"right" | "wrong" | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem("cg_palace_best") || 0); } catch { return 0; } });

  const reset = useCallback((d: Dir) => { setQuestion(newQuestion(d)); setChosen(null); setResult(null); }, []);

  const grade = useCallback((pick: string) => {
    if (result) return;
    setChosen(pick);
    if (pick === question.answer) {
      setResult("right");
      setScore((s) => s + 1);
      setStreak((st) => { const ns = st + 1; setBest((b) => { const nb = Math.max(b, ns); try { localStorage.setItem("cg_palace_best", String(nb)); } catch { /* */ } return nb; }); return ns; });
      window.setTimeout(() => reset(dir), 950);
    } else {
      setResult("wrong");
      setStreak(0);
    }
  }, [result, question.answer, dir, reset]);

  const onBoardClick = useCallback((e: React.MouseEvent) => {
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (mode === "explore") { setSelected(sq); return; }
    if (dir === "find-square") grade(sq);
  }, [mode, dir, grade]);

  // board highlight
  const shapes: DrawShape[] = useMemo(() => {
    if (mode === "explore") return [{ orig: selected as DrawShape["orig"], brush: "blue" }];
    if (dir === "find-scene") return [{ orig: question.answer as DrawShape["orig"], brush: result === "wrong" ? "red" : "green" }];
    if (result) return [{ orig: question.answer as DrawShape["orig"], brush: result === "right" ? "green" : "red" }];
    return [];
  }, [mode, selected, dir, question.answer, result]);

  const boardCoords = mode === "explore" ? coords : false;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Link to="/study" className="text-sm text-ink-400 hover:text-white">&larr; All studies</Link>
        <span className="text-xs font-medium text-ink-500">Memory Palace · 64 Squares</span>
      </div>

      <div>
        <h1 className="font-display text-2xl text-white">🏰 Memory Palace</h1>
        <p className="text-sm text-ink-400">Every square has a funny picture. <b className="text-ink-200">a</b>=animal that starts with the letter, the <b className="text-ink-200">number</b> rhymes (1=Sun, 2=Shoe…). Learn the 64 scenes, then quiz yourself!</p>
      </div>

      {/* level + theme picker */}
      <div>
        <div className="mb-1 flex items-baseline gap-2 text-[11px] uppercase tracking-wide text-ink-500">
          <span>Level</span>
          <span className="text-ink-600">— L1 easiest (all squares repeat objects) → L5 hardest (every theme uniquely varies)</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((L) => {
            const active = themeById(themeId).level === L;
            return (
              <button key={L} onClick={() => {
                // Swap to same theme at the picked level (fall back to easy if not available).
                const base = themeId.replace(/-l\d$/, "");
                const next = `${base}-l${L}`;
                setThemeId(THEMES.find(t => t.id === next)?.id ?? THEMES.find(t => t.level === L)!.id);
                reset(dir);
              }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${active ? "bg-amber-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                Level {L}
              </button>
            );
          })}
        </div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">Picture set</div>
        <div className="flex flex-wrap gap-1.5">
          {THEMES.filter((t) => t.level === themeById(themeId).level).map((t) => (
            <button key={t.id} onClick={() => { setThemeId(t.id); reset(dir); }} title={t.blurb}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${themeId === t.id ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* mode toggle */}
      <div className="flex gap-2">
        {(["explore", "quiz"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize ${mode === m ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
            {m === "explore" ? "📖 Explore" : "🎯 Quiz"}
          </button>
        ))}
      </div>

      {mode === "explore" ? (
        <>
          <p className="text-xs text-ink-500">Tap any square on the board to meet who lives there.</p>
          <SceneCard sq={selected} big scenes={scenes} />
          <div onClick={onBoardClick} style={{ cursor: "pointer" }}>
            <Board fen={EMPTY_FEN} orientation="white" coordinates={boardCoords} viewOnly
              movableColor={undefined} dests={new Map()} shapes={shapes} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCoords((v) => !v)} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800">{coords ? "Hide coords" : "Show coords"}</button>
            <button onClick={() => setShowMap((v) => !v)} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800">{showMap ? "Hide full map" : "Show full map (all 64)"}</button>
            <button onClick={() => setShowCast((v) => !v)} className="flex-1 rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-300 hover:bg-ink-800">{showCast ? "Hide pieces" : "Meet the pieces"}</button>
          </div>

          {showMap && (
            <div className="overflow-x-auto rounded-xl2 border border-ink-700 bg-ink-900 p-2">
              <div className="grid grid-cols-[auto_repeat(8,1fr)] gap-1 text-center">
                <span />
                {FILES.map((f) => <span key={f} className="text-[10px] font-bold text-ink-500">{f}</span>)}
                {[8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
                  <>
                    <span key={`r${r}`} className="grid place-items-center text-[10px] font-bold text-ink-500">{r}</span>
                    {FILES.map((f) => {
                      const sq = f + r; const s = scenes[sq]!;
                      return (
                        <button key={sq} onClick={() => { setSelected(sq); setShowMap(false); }} title={`${sq} — ${s.pair}`}
                          className={`flex flex-col items-center justify-center rounded p-1 leading-none transition hover:ring-2 hover:ring-brand-500 ${isLightSquare(sq) ? "bg-ink-700/40" : "bg-ink-800"}`}>
                          <span className="text-lg">{s.emoji}</span>
                          <span className="mt-0.5 text-[8px] text-ink-400">{sq}</span>
                        </button>
                      );
                    })}
                  </>
                ))}
              </div>
            </div>
          )}

          {showCast && (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">🌟 White — Krishna's Heroes</div>
                <div className="grid gap-2 sm:grid-cols-2">{WHITE_ARMY.map((p) => <PieceRow key={p.role + (p.variant ?? "")} p={p} />)}</div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">🌙 Black — Shiva's Heroes</div>
                <div className="grid gap-2 sm:grid-cols-2">{BLACK_ARMY.map((p) => <PieceRow key={p.role + (p.variant ?? "")} p={p} />)}</div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* direction toggle */}
          <div className="flex gap-2">
            {([["find-scene", "Square → Scene"], ["find-square", "Scene → Square"]] as const).map(([d, label]) => (
              <button key={d} onClick={() => { setDir(d); reset(d); setScore(0); setStreak(0); }}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${dir === d ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* scoreboard */}
          <div className="flex items-center justify-between rounded-xl2 border border-ink-700 bg-ink-900 px-4 py-2 text-sm">
            <span className="font-semibold text-accent-400">&#10003; {score}</span>
            <span className="text-ink-300">🔥 streak {streak}</span>
            <span className="text-ink-400">best {best}</span>
          </div>

          {/* prompt */}
          {dir === "find-scene" ? (
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-center">
              <div className="text-[11px] uppercase tracking-wide text-ink-500">Who lives on</div>
              <div className="font-display text-3xl font-bold text-white">{question.answer}</div>
              <div className="text-[11px] text-ink-400">Tap the matching picture below</div>
            </div>
          ) : (
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-center">
              <div className="text-5xl">{scenes[question.answer]!.emoji}</div>
              <div className="font-display text-xl font-bold text-white">{scenes[question.answer]!.pair}</div>
              <div className="mt-1 text-[11px] text-ink-400">Find this square on the board &amp; tap it</div>
            </div>
          )}

          <div onClick={onBoardClick} style={{ cursor: "pointer" }}>
            <Board fen={EMPTY_FEN} orientation="white" coordinates={false} viewOnly
              movableColor={undefined} dests={new Map()} shapes={shapes} />
          </div>

          {dir === "find-scene" && (
            <div className="grid grid-cols-2 gap-2">
              {question.options.map((sq) => {
                const s = scenes[sq]!;
                const isAnswer = sq === question.answer;
                const isChosen = sq === chosen;
                const tone = result
                  ? isAnswer ? "border-accent-500 bg-accent-500/10"
                  : isChosen ? "border-rose-500 bg-rose-500/10" : "border-ink-700 opacity-50"
                  : "border-ink-700 hover:border-brand-500 hover:bg-ink-800";
                return (
                  <button key={sq} disabled={!!result} onClick={() => grade(sq)}
                    className={`flex items-center gap-2 rounded-xl2 border bg-ink-900 p-3 text-left transition ${tone}`}>
                    <span className="text-3xl">{s.emoji}</span>
                    <span className="text-sm font-semibold text-white">{s.pair}</span>
                  </button>
                );
              })}
            </div>
          )}

          {result === "right" && <div className="rounded-lg bg-accent-500/15 py-2 text-center text-sm font-semibold text-accent-300">🎉 Yes! {scenes[question.answer]!.pair}</div>}
          {result === "wrong" && (
            <div className="space-y-2">
              <div className="rounded-lg bg-rose-500/15 py-2 text-center text-sm font-semibold text-rose-300">Not quite — {question.answer} is {scenes[question.answer]!.pair} {scenes[question.answer]!.emoji}</div>
              <button onClick={() => reset(dir)} className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
