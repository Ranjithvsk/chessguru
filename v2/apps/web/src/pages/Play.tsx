import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import Board from "../components/Board";
import { usePlay } from "../hooks/usePlay";

function guestToken(): string {
  const k = "cg_play_token";
  let t = localStorage.getItem(k);
  if (!t) {
    t = `guest_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, t);
  }
  return t;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const TIME_CONTROLS = [
  { label: "Bullet 1+0", initial: 60000, increment: 0 },
  { label: "Blitz 3+2", initial: 180000, increment: 2000 },
  { label: "Blitz 5+3", initial: 300000, increment: 3000 },
  { label: "Rapid 10+0", initial: 600000, increment: 0 },
];

export default function PlayPage() {
  const ctx = useOutletContext<{ userId: string | null }>();
  const token = useMemo(() => ctx?.userId?.replace(/^u:/, "") ?? guestToken(), [ctx?.userId]);
  const p = usePlay(token);

  const resultText = (() => {
    if (!p.result) return "";
    if (p.result === "1/2-1/2") return `Draw (${p.reason ?? "draw"})`;
    const won = (p.result === "1-0" && p.color === "white") || (p.result === "0-1" && p.color === "black");
    return `${won ? "You won" : "You lost"} — ${p.result} (${p.reason ?? ""})`;
  })();

  const topClock = p.color === "white" ? p.clock.black : p.clock.white;
  const botClock = p.color === "white" ? p.clock.white : p.clock.black;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,520px)_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm text-ink-300" data-testid="opp-clock">
          <span>{p.opponent ? p.opponent.replace(/^u:/, "") : "Opponent"}</span>
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">{fmtClock(topClock)}</span>
        </div>
        <Board
          fen={p.fen}
          orientation={p.color}
          turnColor={p.turn}
          movableColor={p.myTurn ? p.color : undefined}
          dests={p.myTurn ? p.dests : undefined}
          lastMove={p.lastMove}
          viewOnly={p.status !== "playing"}
          onMove={p.sendMove}
        />
        <div className="mt-2 flex items-center justify-between text-sm text-ink-300" data-testid="my-clock">
          <span>You ({p.color})</span>
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">{fmtClock(botClock)}</span>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-ink-400">Status</div>
          <div className="text-lg font-semibold text-white" data-testid="status">
            {p.status === "connecting" && "Connecting…"}
            {p.status === "idle" && "Ready to play"}
            {p.status === "seeking" && "Searching for an opponent…"}
            {p.status === "playing" && (p.myTurn ? "Your move" : "Opponent's move")}
            {p.status === "ended" && (resultText || "Game over")}
          </div>
          <div className="mt-1 text-sm text-ink-400" data-testid="movecount">
            {p.moves.length} move{p.moves.length === 1 ? "" : "s"} played
          </div>
        </div>

        {p.incomingDraw && p.status === "playing" && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="draw-offer-banner">
            <div className="mb-2 text-sm text-amber-200">Your opponent offers a draw.</div>
            <div className="flex gap-2">
              <button data-testid="draw-accept" onClick={p.acceptDraw} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500">
                Accept
              </button>
              <button data-testid="draw-decline" onClick={p.declineDraw} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">
                Decline
              </button>
            </div>
          </div>
        )}

        {(p.status === "idle" || p.status === "ended") && (
          <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
            {p.status === "ended" && (
              <div className="mb-3 flex gap-2">
                <button data-testid="rematch" onClick={p.rematch} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
                  Rematch
                </button>
                <button data-testid="new-game" onClick={p.newGame} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
                  New game
                </button>
              </div>
            )}
            <div className="mb-2 text-xs uppercase tracking-wide text-ink-400">Quick pairing</div>
            <div className="grid grid-cols-2 gap-2">
              {TIME_CONTROLS.map((tc) => (
                <button
                  key={tc.label}
                  data-testid={`seek-${tc.initial}`}
                  onClick={() => p.seek({ initial: tc.initial, increment: tc.increment }, false)}
                  className="rounded-lg bg-ink-800 px-3 py-2 text-sm font-medium text-white hover:bg-ink-700"
                >
                  {tc.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {p.status === "seeking" && <div className="animate-pulse text-sm text-ink-400">Waiting for a match…</div>}

        {p.status === "playing" && (
          <div className="flex gap-2">
            <button data-testid="offer-draw" onClick={p.offerDraw} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
              Offer draw
            </button>
            <button data-testid="resign" onClick={p.resign} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
              Resign
            </button>
          </div>
        )}

        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-ink-400">Moves</div>
          <ol className="grid grid-cols-2 gap-x-4 font-mono text-sm text-ink-200" data-testid="movelist">
            {p.moves.map((m, i) => (
              <li key={i}>
                {i % 2 === 0 ? `${i / 2 + 1}. ` : ""}
                {m}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
