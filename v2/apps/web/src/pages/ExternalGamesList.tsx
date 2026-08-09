// "External games" tab body for /history — one row per imported game with
// result badge + rating + opening + source. Click to open the viewer.
// Refetches on tab-switch (parent controls mount) so imports show up promptly.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_BASE ?? "";

interface ExtGame {
  _id: string; userId: string; source: "lichess" | "chesscom"; gameId: string; url?: string;
  played: string; white: string; black: string;
  whiteRating: number | null; blackRating: number | null;
  result: "1-0" | "0-1" | "1/2-1/2"; timeControl?: string | null; opening?: string | null;
}
interface Resp { items: ExtGame[]; total: number; offset: number; pageSize: number; hasMore: boolean }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function resultChip(result: string, viewpoint: "white"|"black"|null): { txt: string; cls: string } {
  const isDraw = result === "1/2-1/2";
  if (isDraw) return { txt: "½–½", cls: "bg-ink-700/40 text-ink-200 border-ink-600/50" };
  const whiteWon = result === "1-0";
  const iWon = viewpoint === "white" ? whiteWon : viewpoint === "black" ? !whiteWon : false;
  const iLost = viewpoint && !iWon;
  if (iWon)  return { txt: "Win",  cls: "bg-emerald-500/20 text-emerald-100 border-emerald-500/40" };
  if (iLost) return { txt: "Loss", cls: "bg-rose-500/20 text-rose-100 border-rose-500/40" };
  return { txt: result, cls: "bg-ink-700/40 text-ink-200 border-ink-600/50" };
}
function sourceChip(source: string) {
  return source === "lichess"
    ? { txt: "♞ Lichess",   cls: "bg-brand-500/15 text-brand-100 border-brand-500/30" }
    : { txt: "♟ Chess.com", cls: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30" };
}

interface LinkedStatus {
  lichess: { username: string } | null;
  chesscom: ({ username: string } | { pending: true; pendingHandle: string }) | null;
}
function pickHandle(c: LinkedStatus["chesscom"]) { return c && "username" in c ? c.username : undefined; }

export default function ExternalGamesList() {
  const { data: status } = useQuery({ queryKey: ["linked-accounts"], queryFn: () => get<LinkedStatus>("/api/me/linked-accounts") });
  const myHandles = { lichess: status?.lichess?.username, chesscom: pickHandle(status?.chesscom) };
  const [source, setSource] = useState<"all"|"lichess"|"chesscom">("all");
  const [offset, setOffset] = useState(0);
  const q = new URLSearchParams();
  if (source !== "all") q.set("source", source);
  if (offset) q.set("offset", String(offset));
  const { data, isLoading } = useQuery({
    queryKey: ["ext-games", source, offset],
    queryFn: () => get<Resp>(`/api/me/external-games${q.toString() ? `?${q.toString()}` : ""}`),
    refetchInterval: 8000,   // catches fresh imports
  });

  const myViewpoint = (g: ExtGame): "white"|"black"|null => {
    const mine = g.source === "lichess" ? myHandles.lichess : myHandles.chesscom;
    if (!mine) return null;
    const cmp = mine.toLowerCase();
    if (g.white.toLowerCase() === cmp) return "white";
    if (g.black.toLowerCase() === cmp) return "black";
    return null;
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl2 border border-ink-700 bg-ink-900 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Source</span>
        {(["all","lichess","chesscom"] as const).map((s) => (
          <button key={s} onClick={() => { setSource(s); setOffset(0); }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              source === s ? "border-brand-500/50 bg-brand-500/15 text-brand-100"
                           : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>
            {s === "all" ? "All" : s === "lichess" ? "♞ Lichess" : "♟ Chess.com"}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-500 tabular-nums">{total} game{total === 1 ? "" : "s"}</span>
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-ink-400">Loading…</p>}

      {!isLoading && items.length === 0 && (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
          <p className="text-sm text-ink-400">
            No imported games yet.{" "}
            <Link to="/settings/accounts" className="text-brand-400 hover:underline">Link Lichess or Chess.com</Link>{" "}
            to pull in your recent games automatically.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl2 border border-ink-700">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">White</th>
                <th className="px-3 py-2 text-left">Black</th>
                <th className="px-3 py-2 text-left">Result</th>
                <th className="px-3 py-2 text-left">Opening</th>
                <th className="px-3 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => {
                const vp = myViewpoint(g);
                const rc = resultChip(g.result, vp);
                const src = sourceChip(g.source);
                return (
                  <tr key={g._id}
                    className="cursor-pointer border-t border-ink-800 bg-ink-900 hover:bg-ink-800/60"
                    onClick={() => (window.location.href = `/history/external/${encodeURIComponent(g._id)}`)}>
                    <td className="px-3 py-2 text-ink-300">{fmtDate(g.played)}</td>
                    <td className="px-3 py-2 text-white">{g.white} <span className="text-ink-500 tabular-nums">{g.whiteRating ?? "—"}</span></td>
                    <td className="px-3 py-2 text-white">{g.black} <span className="text-ink-500 tabular-nums">{g.blackRating ?? "—"}</span></td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${rc.cls}`}>{rc.txt}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-400 truncate max-w-[240px]" title={g.opening ?? ""}>{g.opening ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] ${src.cls}`}>{src.txt}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between bg-ink-900 px-3 py-2 text-xs text-ink-400">
            <button onClick={() => setOffset(Math.max(0, offset - 50))} disabled={offset === 0}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800 disabled:opacity-40">← Prev</button>
            <span className="tabular-nums">{offset + 1}–{Math.min(offset + items.length, total)} of {total}</span>
            <button onClick={() => setOffset(offset + 50)} disabled={!data?.hasMore}
              className="rounded border border-ink-700 px-2 py-1 hover:bg-ink-800 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
