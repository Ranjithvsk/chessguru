import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Key } from "chessground/types";
import type { Color, ServerMsg, TimeControl } from "@chessguru/protocol";
import { LiveClient } from "../lib/live";
import { destsFromChess } from "../components/Board";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:18080/ws";

export type PlayStatus = "connecting" | "idle" | "seeking" | "playing" | "ended";
export type Promo = "q" | "r" | "b" | "n";

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
  seek: (clock: TimeControl, rated?: boolean) => void;
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

/** All realtime game state for the Play page, driven by one LiveClient. */
export function usePlay(token: string): PlayState {
  const client = useRef<LiveClient | null>(null);
  const game = useRef(new Chess());
  const gameIdRef = useRef<string | null>(null);
  const plyRef = useRef(0);
  const colorRef = useRef<Color>("white");
  const tokenRef = useRef(token);
  const pendingRef = useRef<{ from: Key; to: Key } | null>(null);
  tokenRef.current = token;

  const [status, setStatus] = useState<PlayStatus>("connecting");
  const [color, setColor] = useState<Color>("white");
  const [fen, setFen] = useState(game.current.fen());
  const [turn, setTurn] = useState<Color>("white");
  const [ply, setPly] = useState(0);
  const [moves, setMoves] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [clock, setClock] = useState({ white: 0, black: 0 });
  const [opponent, setOpponent] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [incomingDraw, setIncomingDraw] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Key; to: Key } | null>(null);
  const [boardEpoch, setBoardEpoch] = useState(0);

  const clearPending = () => {
    pendingRef.current = null;
    setPendingPromotion(null);
  };
  const loadFen = (f: string) => {
    try {
      game.current.load(f);
    } catch {
      /* ignore */
    }
    setFen(f);
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
    client.current?.sub(g);
    setStatus("playing");
  };

  const onMsg = (m: ServerMsg) => {
    switch (m.t) {
      case "matched":
        startGame(m.d.game, m.d.color, m.d.opponent);
        break;
      case "rematch-ready": {
        const me = `u:${tokenRef.current}`;
        const myColor: Color = m.d.white === me ? "white" : "black";
        startGame(m.d.game, myColor, myColor === "white" ? m.d.black : m.d.white);
        break;
      }
      case "game-state":
        loadFen(m.d.fen);
        setTurn(m.d.turn);
        plyRef.current = m.d.ply;
        setPly(m.d.ply);
        setClock(m.d.clock);
        setMoves(m.d.moves);
        setIncomingDraw(false);
        clearPending();
        if (m.d.status !== "playing") {
          setStatus("ended");
          setResult(m.d.result);
        }
        break;
      case "moved":
        loadFen(m.d.fen);
        setTurn(m.d.turn);
        plyRef.current = m.d.ply + 1;
        setPly(m.d.ply + 1);
        setClock(m.d.clock);
        setLastMove([m.d.uci.slice(0, 2) as Key, m.d.uci.slice(2, 4) as Key]);
        setMoves((mv) => [...mv, m.d.san]);
        setIncomingDraw(false);
        clearPending();
        break;
      case "clock":
        setClock(m.d.clock);
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
        setClock(m.d.clock);
        setIncomingDraw(false);
        clearPending();
        setStatus("ended");
        break;
    }
  };

  useEffect(() => {
    const c = new LiveClient();
    client.current = c;
    let off = () => {};
    const g = () => gameIdRef.current;
    c.connect(WS_URL)
      .then(() => {
        c.hello(tokenRef.current);
        setStatus("idle");
        off = c.on(onMsg);
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
            state: () => ({ game: g(), ply: plyRef.current, color: colorRef.current }),
          };
        }
      })
      .catch(() => setStatus("idle"));
    return () => {
      off();
      c.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback((clock: TimeControl, rated = false) => {
    client.current?.seek(clock, rated);
    setStatus("seeking");
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

  return {
    status, color, fen, turn, ply, moves, lastMove, clock, opponent, result, reason, incomingDraw, challengeId,
    pendingPromotion, boardEpoch, dests, myTurn,
    seek, createChallenge, sendMove, premove, choosePromotion, cancelPromotion, resign, offerDraw, acceptDraw, declineDraw, rematch, newGame,
  };
}
