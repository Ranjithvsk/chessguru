import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Key } from "chessground/types";
import type { Color, ServerMsg, TimeControl } from "@chessguru/protocol";
import { LiveClient } from "../lib/live";
import { destsFromChess } from "../components/Board";

// Same-origin by default: the SPA is served from several hostnames, so a baked-in
// absolute URL would break every host but one. nginx proxies /ws to the gateway.
const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export type PlayStatus = "connecting" | "idle" | "seeking" | "playing" | "ended";
export type Promo = "q" | "r" | "b" | "n";

// The game we are in survives a refresh: the server keeps playing the clock, so
// coming back to an empty lobby while your game ticks away is the worst outcome.
const RESUME_KEY = "cg_play_game";

export interface PlayState {
  status: PlayStatus;
  color: Color;
  fen: string;
  turn: Color;
  ply: number;
  moves: string[];
  lastMove?: [Key, Key];
  clock: { white: number; black: number };
  opponent: string | null;
  result: string | null;
  reason: string | null;
  incomingDraw: boolean;
  challengeId: string | null;
  pendingPromotion: { from: Key; to: Key } | null;
  boardEpoch: number;
  dests: ReturnType<typeof destsFromChess>;
  myTurn: boolean;
  /** Our own id as the gateway sees it (`u:…` signed in, `g:…` guest). */
  selfId: string | null;
  /** False while the socket is down and reconnecting. */
  connected: boolean;
  /** Set while the opponent has no socket on the game. */
  oppGone: { since: number; claimableAt: number } | null;
  canAbort: boolean;
  /** Whether the current game counts for rating. */
  rated: boolean;
  /** Our rating change once a rated game ends. */
  ratingDiff: number | null;
  seek: (clock: TimeControl, rated?: boolean) => void;
  cancelSeek: () => void;
  abort: () => void;
  claim: () => void;
  createChallenge: (clock: TimeControl, rated?: boolean) => void;
  sendMove: (from: Key, to: Key) => void;
  premove: (from: Key, to: Key) => void;
  choosePromotion: (p: Promo) => void;
  cancelPromotion: () => void;
  resign: () => void;
  offerDraw: () => void;
  acceptDraw: () => void;
  declineDraw: () => void;
  rematch: () => void;
  newGame: () => void;
}

const isPromotion = (game: Chess, from: Key, to: Key): boolean => {
  const piece = game.get(from as Square);
  return piece?.type === "p" && (to[1] === "8" || to[1] === "1");
};

/** All realtime game state for the Play page, driven by one LiveClient.
 *  `guest` names a signed-out visitor; signed-in identity is the session cookie. */
export function usePlay(guest: string | null): PlayState {
  const client = useRef<LiveClient | null>(null);
  const game = useRef(new Chess());
  const gameIdRef = useRef<string | null>(null);
  const plyRef = useRef(0);
  const colorRef = useRef<Color>("white");
  const selfIdRef = useRef<string | null>(null);
  const guestRef = useRef(guest);
  const pendingRef = useRef<{ from: Key; to: Key } | null>(null);
  const resumingRef = useRef(false);
  guestRef.current = guest;

  const [status, setStatus] = useState<PlayStatus>("connecting");
  const [color, setColor] = useState<Color>("white");
  const [fen, setFen] = useState(game.current.fen());
  const [turn, setTurn] = useState<Color>("white");
  const [ply, setPly] = useState(0);
  const [moves, setMoves] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [clock, setClock] = useState({ white: 0, black: 0 });
  // The server only broadcasts the clock every 2s, so the raw value visibly jumps.
  // Keep the authoritative snapshot plus when it arrived and run the seconds down
  // locally between broadcasts; each broadcast re-anchors, so drift can't accumulate.
  const clockAt = useRef(0);
  const clockRunning = useRef(false);
  const [clockTick, setClockTick] = useState(0);
  const [opponent, setOpponent] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [incomingDraw, setIncomingDraw] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Key; to: Key } | null>(null);
  const [boardEpoch, setBoardEpoch] = useState(0);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [oppGone, setOppGone] = useState<{ since: number; claimableAt: number } | null>(null);
  const [rated, setRated] = useState(false);
  const [ratingDiff, setRatingDiff] = useState<number | null>(null);

  const clearPending = () => {
    pendingRef.current = null;
    setPendingPromotion(null);
  };
  const applyClock = (c: { white: number; black: number }, running?: boolean) => {
    clockAt.current = Date.now();
    if (running !== undefined) clockRunning.current = running;
    setClock(c);
  };
  const loadFen = (f: string) => {
    try {
      game.current.load(f);
    } catch {
      /* ignore */
    }
    setFen(f);
  };

  const remember = (g: string | null) => {
    try {
      if (g) sessionStorage.setItem(RESUME_KEY, g);
      else sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const startGame = (g: string, myColor: Color, opp: string | null) => {
    gameIdRef.current = g;
    colorRef.current = myColor;
    plyRef.current = 0;
    game.current.reset();
    clearPending();
    setColor(myColor);
    setOpponent(opp);
    setFen(game.current.fen());
    setTurn("white");
    setPly(0);
    setMoves([]);
    setLastMove(undefined);
    setResult(null);
    setReason(null);
    setIncomingDraw(false);
    setChallengeId(null);
    setOppGone(null);
    setRatingDiff(null);
    remember(g);
    client.current?.sub(g);
    setStatus("playing");
  };

  const oppColor = (): Color => (colorRef.current === "white" ? "black" : "white");

  const onMsg = (m: ServerMsg) => {
    switch (m.t) {
      case "hello-ok":
        selfIdRef.current = m.d.userId;
        setSelfId(m.d.userId);
        break;
      case "matched":
        startGame(m.d.game, m.d.color, m.d.opponent);
        setRated(m.d.rated);
        break;
      case "rematch-ready": {
        const me = selfIdRef.current;
        const myColor: Color = m.d.white === me ? "white" : "black";
        startGame(m.d.game, myColor, myColor === "white" ? m.d.black : m.d.white);
        break;
      }
      case "game-state": {
        if (m.g !== gameIdRef.current) break; // a stale tab's game, not ours
        if (resumingRef.current) {
          // Came back after a refresh/drop: the server's seats tell us who we are.
          resumingRef.current = false;
          const me = selfIdRef.current;
          const mine: Color | null = m.d.players.white === me ? "white" : m.d.players.black === me ? "black" : null;
          if (!mine || m.d.status !== "playing") {
            gameIdRef.current = null;
            remember(null);
            setStatus("idle");
            break;
          }
          colorRef.current = mine;
          setColor(mine);
          setOpponent(mine === "white" ? m.d.players.black : m.d.players.white);
          setResult(null);
          setReason(null);
          setChallengeId(null);
          setStatus("playing");
        }
        setRated(m.d.rated);
        loadFen(m.d.fen);
        setTurn(m.d.turn);
        plyRef.current = m.d.ply;
        setPly(m.d.ply);
        applyClock(m.d.clock, m.d.status === "playing");
        setMoves(m.d.moves);
        if (m.d.moves.length) {
          const last = m.d.moves[m.d.moves.length - 1]!;
          setLastMove([last.slice(0, 2) as Key, last.slice(2, 4) as Key]);
        }
        setIncomingDraw(false);
        clearPending();
        const goneSince = m.d.gone?.[oppColor()] ?? null;
        setOppGone(goneSince !== null && m.d.status === "playing" ? { since: goneSince, claimableAt: goneSince + (m.d.graceMs ?? 30000) } : null);
        if (m.d.status !== "playing") {
          setStatus("ended");
          setResult(m.d.result);
          remember(null);
        }
        break;
      }
      case "presence":
        if (m.g !== gameIdRef.current || m.d.color === colorRef.current) break;
        setOppGone(m.d.online || m.d.claimableAt === null ? null : { since: Date.now(), claimableAt: m.d.claimableAt });
        break;
      case "moved":
        loadFen(m.d.fen);
        setTurn(m.d.turn);
        plyRef.current = m.d.ply + 1;
        setPly(m.d.ply + 1);
        applyClock(m.d.clock);
        setLastMove([m.d.uci.slice(0, 2) as Key, m.d.uci.slice(2, 4) as Key]);
        setMoves((mv) => [...mv, m.d.san]);
        setIncomingDraw(false);
        clearPending();
        break;
      case "clock":
        applyClock(m.d.clock, m.d.running);
        setTurn(m.d.turn);
        break;
      case "challenge-created":
        setChallengeId(m.d.id);
        setStatus("seeking");
        break;
      case "offer":
        if (m.d.kind === "draw" && m.d.by !== colorRef.current) setIncomingDraw(true);
        break;
      case "game-end":
        setResult(m.d.result);
        setReason(m.d.reason);
        setRatingDiff(m.d.ratingDiff ? Math.round(m.d.ratingDiff[colorRef.current]) : null);
        applyClock(m.d.clock, false);
        setIncomingDraw(false);
        setOppGone(null);
        clearPending();
        remember(null);
        setStatus("ended");
        break;
    }
  };

  useEffect(() => {
    const c = new LiveClient();
    client.current = c;
    const g = () => gameIdRef.current;
    const off = c.on(onMsg);
    const offStatus = c.onStatus(setConnected);
    // Every (re)open: say who we are, then re-attach to the game we were in.
    const offOpen = c.onOpen(() => {
      c.hello(guestRef.current ?? undefined);
      const cur = gameIdRef.current;
      if (cur) c.resync(cur, plyRef.current);
    });
    c.connect(WS_URL)
      .then(() => {
        setStatus("idle");
        let saved: string | null = null;
        try {
          saved = sessionStorage.getItem(RESUME_KEY);
        } catch {
          /* storage unavailable */
        }
        if (saved && !gameIdRef.current) {
          resumingRef.current = true;
          gameIdRef.current = saved;
          c.sub(saved);
        }
        const cid = new URLSearchParams(window.location.search).get("challenge");
        if (cid) {
          c.challengeAccept(cid);
          window.history.replaceState({}, "", window.location.pathname);
        }
        if (import.meta.env.DEV) {
          (window as unknown as { __play?: unknown }).__play = {
            seek: (initial = 300000, increment = 3000, rated = false) => c.seek({ initial, increment }, rated),
            move: (uci: string) => g() && c.move(g()!, uci, plyRef.current),
            premove: (uci: string) => g() && c.premove(g()!, uci),
            resign: () => g() && c.resign(g()!),
            offerDraw: () => g() && c.drawOffer(g()!),
            acceptDraw: () => g() && c.drawAccept(g()!),
            rematch: () => g() && c.rematch(g()!),
            abort: () => g() && c.abort(g()!),
            claim: () => g() && c.claim(g()!),
            state: () => ({ game: g(), ply: plyRef.current, color: colorRef.current, self: selfIdRef.current }),
          };
        }
      })
      .catch(() => setStatus("idle"));
    return () => {
      off();
      offStatus();
      offOpen();
      c.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback((clock: TimeControl, rated = false) => {
    client.current?.seek(clock, rated);
    setStatus("seeking");
  }, []);

  const cancelSeek = useCallback(() => {
    client.current?.unseek();
    setChallengeId(null);
    setStatus("idle");
  }, []);

  const abort = useCallback(() => {
    if (gameIdRef.current) client.current?.abort(gameIdRef.current);
  }, []);
  const claim = useCallback(() => {
    if (gameIdRef.current) client.current?.claim(gameIdRef.current);
  }, []);

  const createChallenge = useCallback((clock: TimeControl, rated = false) => {
    client.current?.challenge(clock, rated);
    setStatus("seeking");
  }, []);

  const sendMove = useCallback((from: Key, to: Key) => {
    const gid = gameIdRef.current;
    if (!gid) return;
    if (isPromotion(game.current, from, to)) {
      pendingRef.current = { from, to };
      setPendingPromotion({ from, to });
      return; // wait for the user to pick a piece
    }
    client.current?.move(gid, `${from}${to}`, plyRef.current);
  }, []);

  const premove = useCallback((from: Key, to: Key) => {
    const gid = gameIdRef.current;
    if (!gid) return;
    const promo = isPromotion(game.current, from, to) ? "q" : ""; // premoves auto-queen
    client.current?.premove(gid, `${from}${to}${promo}`);
  }, []);

  const choosePromotion = useCallback((p: Promo) => {
    const gid = gameIdRef.current;
    const pend = pendingRef.current;
    if (gid && pend) client.current?.move(gid, `${pend.from}${pend.to}${p}`, plyRef.current);
    clearPending();
  }, []);

  const cancelPromotion = useCallback(() => {
    clearPending();
    setBoardEpoch((e) => e + 1); // remount the board to snap the pawn back
  }, []);

  const resign = useCallback(() => {
    if (gameIdRef.current) client.current?.resign(gameIdRef.current);
  }, []);
  const offerDraw = useCallback(() => {
    if (gameIdRef.current) client.current?.drawOffer(gameIdRef.current);
  }, []);
  const acceptDraw = useCallback(() => {
    if (gameIdRef.current) client.current?.drawAccept(gameIdRef.current);
    setIncomingDraw(false);
  }, []);
  const declineDraw = useCallback(() => {
    if (gameIdRef.current) client.current?.drawDecline(gameIdRef.current);
    setIncomingDraw(false);
  }, []);
  const rematch = useCallback(() => {
    if (gameIdRef.current) client.current?.rematch(gameIdRef.current);
  }, []);
  const newGame = useCallback(() => {
    gameIdRef.current = null;
    remember(null);
    setOppGone(null);
    setStatus("idle");
    setResult(null);
    setReason(null);
    setMoves([]);
    setIncomingDraw(false);
    setChallengeId(null);
    clearPending();
  }, []);

  const myTurn = status === "playing" && turn === color;
  const dests = useMemo(() => destsFromChess(game.current as never), [fen]);

  // 50ms so the sub-second digits in the last 10s actually read as counting down
  // rather than stepping.
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => setClockTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [status]);

  const liveClock = useMemo(() => {
    if (status !== "playing" || !clockRunning.current || !clockAt.current) return clock;
    const elapsed = Date.now() - clockAt.current;
    return { ...clock, [turn]: Math.max(0, clock[turn] - elapsed) };
    // clockTick drives the recompute; Date.now() is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, turn, status, clockTick]);

  const canAbort = status === "playing" && moves.length < 2;

  return {
    status, color, fen, turn, ply, moves, lastMove, clock: liveClock, opponent, result, reason, incomingDraw, challengeId,
    pendingPromotion, boardEpoch, dests, myTurn, selfId, connected, oppGone, canAbort, rated, ratingDiff,
    seek, cancelSeek, abort, claim, createChallenge, sendMove, premove, choosePromotion, cancelPromotion, resign, offerDraw, acceptDraw, declineDraw, rematch, newGame,
  };
}
