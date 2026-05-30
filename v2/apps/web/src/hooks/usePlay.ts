import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Key } from "chessground/types";
import type { Color, ServerMsg, TimeControl } from "@chessguru/protocol";
import { LiveClient } from "../lib/live";
import { destsFromChess } from "../components/Board";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:18080/ws";

export type PlayStatus = "connecting" | "idle" | "seeking" | "playing" | "ended";

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
  dests: ReturnType<typeof destsFromChess>;
  myTurn: boolean;
  seek: (clock: TimeControl, rated?: boolean) => void;
  sendMove: (from: Key, to: Key) => void;
  resign: () => void;
  newGame: () => void;
}

/** All realtime game state for the Play page, driven by one LiveClient. */
export function usePlay(token: string): PlayState {
  const client = useRef<LiveClient | null>(null);
  const game = useRef(new Chess());
  const gameIdRef = useRef<string | null>(null);
  const plyRef = useRef(0);
  const colorRef = useRef<Color>("white");

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

  const loadFen = (f: string) => {
    try {
      game.current.load(f);
    } catch {
      /* ignore */
    }
    setFen(f);
  };

  const onMsg = (m: ServerMsg) => {
    switch (m.t) {
      case "matched":
        gameIdRef.current = m.d.game;
        colorRef.current = m.d.color;
        setColor(m.d.color);
        setOpponent(m.d.opponent);
        setResult(null);
        setReason(null);
        setMoves([]);
        setLastMove(undefined);
        client.current?.sub(m.d.game);
        setStatus("playing");
        break;
      case "game-state":
        loadFen(m.d.fen);
        setTurn(m.d.turn);
        plyRef.current = m.d.ply;
        setPly(m.d.ply);
        setClock(m.d.clock);
        setMoves(m.d.moves);
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
        break;
      case "clock":
        setClock(m.d.clock);
        setTurn(m.d.turn);
        break;
      case "game-end":
        setResult(m.d.result);
        setReason(m.d.reason);
        setClock(m.d.clock);
        setStatus("ended");
        break;
    }
  };

  useEffect(() => {
    const c = new LiveClient();
    client.current = c;
    let off = () => {};
    c.connect(WS_URL)
      .then(() => {
        c.hello(token);
        setStatus("idle");
        off = c.on(onMsg);
        if (import.meta.env.DEV) {
          (window as unknown as { __play?: unknown }).__play = {
            seek: (initial = 300000, increment = 3000, rated = false) => c.seek({ initial, increment }, rated),
            move: (uci: string) => gameIdRef.current && c.move(gameIdRef.current, uci, plyRef.current),
            resign: () => gameIdRef.current && c.resign(gameIdRef.current),
            state: () => ({ game: gameIdRef.current, ply: plyRef.current, color: colorRef.current }),
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

  const sendMove = useCallback((from: Key, to: Key) => {
    const g = gameIdRef.current;
    if (!g) return;
    const piece = game.current.get(from as Square);
    const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : "";
    client.current?.move(g, `${from}${to}${promo}`, plyRef.current);
  }, []);

  const resign = useCallback(() => {
    if (gameIdRef.current) client.current?.resign(gameIdRef.current);
  }, []);

  const newGame = useCallback(() => {
    gameIdRef.current = null;
    setStatus("idle");
    setResult(null);
    setReason(null);
    setMoves([]);
  }, []);

  const myTurn = status === "playing" && turn === color;
  const dests = useMemo(() => destsFromChess(game.current as never), [fen]);

  return { status, color, fen, turn, ply, moves, lastMove, clock, opponent, result, reason, dests, myTurn, seek, sendMove, resign, newGame };
}
