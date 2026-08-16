// Import games from Lichess / Chess.com / PGN paste. Route: /my-games/import

import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { myGamesApi } from "../lib/my-games-api";

type Tab = "lichess" | "chesscom" | "pgn";

export default function MyGamesImportPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("lichess");
  const [username, setUsername] = useState("");
  const [max, setMax] = useState(10);
  const [pgn, setPgn] = useState("");
  const [ourColor, setOurColor] = useState<"white" | "black" | "both">("both");
  const [err, setErr] = useState("");

  const importLichess = useMutation({
    mutationFn: () => myGamesApi.importLichess({ username: username.trim(), max }),
    onSuccess: (r) => { if (r.imported > 0) nav("/my-games"); else setErr("Nothing new to import (all these games are already in your library)."); },
    onError: (e: any) => setErr(String(e?.message || e)),
  });
  const importChesscom = useMutation({
    mutationFn: () => myGamesApi.importChesscom({ username: username.trim(), max }),
    onSuccess: (r) => { if (r.imported > 0) nav("/my-games"); else setErr("Nothing new to import."); },
    onError: (e: any) => setErr(String(e?.message || e)),
  });
  const importPgn = useMutation({
    mutationFn: () => myGamesApi.importPgn({ pgn, ourColor }),
    onSuccess: (r) => { if (r.imported > 0) nav("/my-games"); else setErr("No games parsed from that PGN."); },
    onError: (e: any) => setErr(String(e?.message || e)),
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/my-games/import" replace />;

  const busy = importLichess.isPending || importChesscom.isPending || importPgn.isPending;

  return (
    <div className="mx-auto max-w-3xl px-3 py-6">
      <Link to="/my-games" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← My Games</Link>
      <h1 className="mb-4 font-display text-2xl text-white">Import games</h1>

      <div className="mb-4 flex gap-2 rounded-xl border border-ink-700 bg-ink-900 p-2">
        {[
          { id: "lichess" as Tab,  label: "♞ Lichess" },
          { id: "chesscom" as Tab, label: "♛ Chess.com" },
          { id: "pgn" as Tab,      label: "📋 Paste PGN" },
        ].map((t) => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); setErr(""); }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === t.id ? "bg-brand-600 text-white" : "text-ink-300 hover:bg-ink-800 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "lichess" || tab === "chesscom") && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">{tab === "lichess" ? "Lichess" : "Chess.com"} username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. drnykterstein"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Number of recent games: {max}</label>
            <input type="range" min="1" max="30" value={max} onChange={(e) => setMax(Number(e.target.value))}
              className="w-full accent-brand-500" />
            <div className="mt-1 text-[10px] text-ink-500">Analysis takes ~1s per move — 10 games ≈ 3–5 min to fully analyze.</div>
          </div>
          {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}
          <button type="button" disabled={!username.trim() || busy}
            onClick={() => tab === "lichess" ? importLichess.mutate() : importChesscom.mutate()}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "Importing…" : `Import from ${tab === "lichess" ? "Lichess" : "Chess.com"} →`}
          </button>
        </div>
      )}

      {tab === "pgn" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Paste PGN (one game or many)</label>
            <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={12}
              placeholder={`[Event "Casual"]\n[White "Me"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 …`}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-xs text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Which side is "you"?</label>
            <div className="flex gap-2">
              {(["white", "black", "both"] as const).map((c) => (
                <button key={c} type="button" onClick={() => setOurColor(c)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${ourColor === c ? "bg-brand-600 text-white" : "border border-ink-700 text-ink-300 hover:bg-ink-800 hover:text-white"}`}>
                  {c === "white" ? "White" : c === "black" ? "Black" : "Both (auto-detect)"}
                </button>
              ))}
            </div>
          </div>
          {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}
          <button type="button" disabled={!pgn.trim() || busy}
            onClick={() => importPgn.mutate()}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "Importing…" : "Import PGN →"}
          </button>
        </div>
      )}
    </div>
  );
}
