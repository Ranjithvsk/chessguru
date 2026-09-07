import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Board from "../components/Board";
import { usePlay, type Promo } from "../hooks/usePlay";
import PassPlay from "../components/PassPlay";

function guestToken(): string {
  const k = "cg_play_token";
  let t = localStorage.getItem(k);
  if (!t) {
    t = `guest_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(k, t);
  }
  return t;
}

/** Ids on the wire are `u:<account>` or `g:<guest>`; show neither prefix. */
const displayName = (id: string | null): string => (id ? id.replace(/^(u|g):/, "") : "Opponent");

function fmtClock(ms: number): string {
  const t = Math.max(0, ms);
  // Under 10s the hundredths are what tells you whether you can still make the move.
  if (t < 10000) return `${Math.floor(t / 1000)}.${String(Math.floor((t % 1000) / 10)).padStart(2, "0")}`;
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const TIME_CONTROLS = [
  { label: "Bullet 1+0", initial: 60000, increment: 0 },
  { label: "Blitz 3+2", initial: 180000, increment: 2000 },
  { label: "Blitz 5+3", initial: 300000, increment: 3000 },
  { label: "Rapid 10+0", initial: 600000, increment: 0 },
];

// The lobby seeds a bot opponent 11–18s into a lonely seek, so nearly every wait
// ends inside this window. A visible countdown keeps a student at the board for
// those seconds instead of bouncing at "Searching…" with no sign of progress.
const EXPECTED_WAIT_S = 18;

function seekPhase(elapsedS: number): string {
  if (elapsedS < 4) return "Looking for an opponent…";
  if (elapsedS < 10) return "Checking players near your rating…";
  if (elapsedS < EXPECTED_WAIT_S) return "Almost there — pairing you now…";
  return "Any moment now… hang on";
}

const PROMO_PIECES: { p: Promo; glyph: string }[] = [
  { p: "q", glyph: "♛" },
  { p: "r", glyph: "♜" },
  { p: "b", glyph: "♝" },
  { p: "n", glyph: "♞" },
];

export default function PlayPage() {
  const ctx = useOutletContext<{ userId: string | null }>();
  // Signed-in identity is the session cookie the gateway reads on connect; only a
  // signed-out visitor needs a client-side name.
  const guest = useMemo(() => (ctx?.userId ? null : guestToken()), [ctx?.userId]);
  const p = usePlay(guest);
  const [mode, setMode] = useState<"online" | "local">("online");
  // Ticks once a second while the opponent is away so the claim countdown moves.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!p.oppGone) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.oppGone]);
  // Seek wait: remember when the search began and tick while it runs.
  const [seekStartedAt, setSeekStartedAt] = useState<number | null>(null);
  const [seekTick, setSeekTick] = useState(0);
  const seeking = p.status === "seeking" && !p.challengeId;
  useEffect(() => {
    if (!seeking) {
      setSeekStartedAt(null);
      return;
    }
    setSeekStartedAt(Date.now());
    const id = setInterval(() => setSeekTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [seeking]);
  const seekElapsedS = seekStartedAt ? (Date.now() - seekStartedAt) / 1000 : 0;
  const seekLeftS = Math.max(0, Math.ceil(EXPECTED_WAIT_S - seekElapsedS));
  const seekPct = Math.min(100, (seekElapsedS / EXPECTED_WAIT_S) * 100);
  void seekTick;

  const resultText = (() => {
    if (p.reason === "aborted" || p.result === "*") return "Game aborted";
    if (!p.result) return "";
    if (p.result === "1/2-1/2") return `Draw (${p.reason ?? "draw"})`;
    const won = (p.result === "1-0" && p.color === "white") || (p.result === "0-1" && p.color === "black");
    const why = p.reason === "abandoned" ? (won ? "opponent left" : "you left") : p.reason ?? "";
    return `${won ? "You won" : "You lost"} — ${p.result} (${why})`;
  })();
  const claimIn = p.oppGone ? Math.max(0, Math.ceil((p.oppGone.claimableAt - nowTick) / 1000)) : 0;

  const topClock = p.color === "white" ? p.clock.black : p.clock.white;
  const botClock = p.color === "white" ? p.clock.white : p.clock.black;
  const playing = p.status === "playing";

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-ink-700 bg-ink-900/60 p-1" data-testid="play-mode">
        <button onClick={() => setMode("online")} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${mode === "online" ? "bg-brand-600 text-white" : "text-ink-300 hover:text-white"}`}>Online</button>
        <button onClick={() => setMode("local")} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${mode === "local" ? "bg-brand-600 text-white" : "text-ink-300 hover:text-white"}`}>Pass &amp; Play</button>
      </div>

      {mode === "local" ? (
        <PassPlay />
      ) : (
      <div className="grid gap-6 md:grid-cols-[minmax(0,520px)_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm text-ink-300" data-testid="opp-clock">
          <span>
            {displayName(p.opponent)}
            {p.oppGone && playing && <span className="ml-2 text-xs text-amber-300">away</span>}
          </span>
          <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">{fmtClock(topClock)}</span>
        </div>

        <div className="relative">
          <Board
            key={p.boardEpoch}
            fen={p.fen}
            orientation={p.color}
            turnColor={p.turn}
            movableColor={playing ? p.color : undefined}
            dests={p.myTurn ? p.dests : undefined}
            premovable={playing}
            onPremove={p.premove}
            lastMove={p.lastMove}
            viewOnly={!playing}
            onMove={p.sendMove}
          />

          {p.pendingPromotion && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-ink-900/70" data-testid="promo-overlay">
              <div className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-center">
                <div className="mb-2 text-sm text-ink-300">Promote to</div>
                <div className="flex gap-2">
                  {PROMO_PIECES.map(({ p: pc, glyph }) => (
                    <button
                      key={pc}
                      data-testid={`promote-${pc}`}
                      onClick={() => p.choosePromotion(pc)}
                      className="grid h-12 w-12 place-items-center rounded-lg bg-ink-800 text-2xl text-white hover:bg-brand-600"
                    >
                      {glyph}
                    </button>
                  ))}
                </div>
                <button onClick={p.cancelPromotion} className="mt-3 text-xs text-ink-400 hover:text-white">
                  cancel
                </button>
              </div>
            </div>
          )}
        </div>

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
            {playing && (p.myTurn ? "Your move" : "Opponent's move")}
            {p.status === "ended" && (resultText || "Game over")}
          </div>
          <div className="mt-1 text-sm text-ink-400" data-testid="movecount">
            {p.moves.length} move{p.moves.length === 1 ? "" : "s"} played
          </div>
          {!p.connected && p.status !== "connecting" && (
            <div className="mt-2 inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200" data-testid="reconnecting">
              Reconnecting…
            </div>
          )}
        </div>

        {p.oppGone && playing && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="opp-gone-banner">
            <div className="mb-2 text-sm text-amber-200">
              {p.canAbort
                ? "Your opponent left before the game got going."
                : claimIn > 0
                  ? `Your opponent disconnected. You can claim the win in ${claimIn}s if they don't return.`
                  : "Your opponent has not come back."}
            </div>
            {p.canAbort ? (
              <button data-testid="abort-gone" onClick={p.abort} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500">
                Abort game
              </button>
            ) : (
              <button
                data-testid="claim"
                onClick={p.claim}
                disabled={claimIn > 0}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Claim victory
              </button>
            )}
          </div>
        )}

        {p.incomingDraw && playing && (
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
            <button
              data-testid="challenge-friend"
              onClick={() => p.createChallenge({ initial: 300000, increment: 3000 }, false)}
              className="mt-2 w-full rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-200 hover:bg-ink-800"
            >
              Challenge a friend (5+3)
            </button>
          </div>
        )}

        {p.status === "seeking" && p.challengeId && (
          <div className="rounded-xl border border-brand-500/50 bg-brand-600/10 p-4" data-testid="challenge-link">
            <div className="mb-2 text-sm text-ink-200">Send this link to a friend — the game starts when they open it:</div>
            <input
              readOnly
              data-testid="challenge-url"
              value={`${location.origin}${import.meta.env.BASE_URL}play?challenge=${p.challengeId}`}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg bg-ink-900 px-3 py-2 font-mono text-xs text-ink-200"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(`${location.origin}${import.meta.env.BASE_URL}play?challenge=${p.challengeId}`)}
              className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              Copy link
            </button>
            <div className="mt-2 animate-pulse text-xs text-ink-400">Waiting for your friend to join…</div>
          </div>
        )}

        {p.status === "seeking" && (
          <div className="rounded-xl border border-brand-500/40 bg-brand-600/10 p-4" data-testid="seek-wait">
            {!p.challengeId && (
              <>
                <div className="flex items-center gap-3">
                  <span className="inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white" data-testid="seek-phase">{seekPhase(seekElapsedS)}</div>
                    <div className="text-xs text-ink-400" data-testid="seek-eta">
                      {seekLeftS > 0 ? `Opponent expected in about ${seekLeftS}s` : "Most games start within 20 seconds"}
                    </div>
                  </div>
                  <span className="font-mono text-sm text-ink-300" data-testid="seek-elapsed">{Math.floor(seekElapsedS)}s</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                  <div
                    className={`h-full rounded-full bg-brand-500 transition-[width] duration-300 ${seekPct >= 100 ? "animate-pulse" : ""}`}
                    style={{ width: `${seekPct}%` }}
                  />
                </div>
              </>
            )}
            <button data-testid="cancel-seek" onClick={p.cancelSeek} className="mt-3 rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">
              Cancel
            </button>
          </div>
        )}

        {playing && (
          <div className="flex gap-2">
            <button data-testid="offer-draw" onClick={p.offerDraw} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
              Offer draw
            </button>
            {p.canAbort ? (
              // Nobody has committed yet — walking away is an abort, not a loss.
              <button data-testid="abort" onClick={p.abort} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
                Abort
              </button>
            ) : (
              <button data-testid="resign" onClick={p.resign} className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:text-white">
                Resign
              </button>
            )}
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
      )}
    </div>
  );
}
