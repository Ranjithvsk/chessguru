// Student notebook — inbox for position packs that coaches broadcast from
// a live Dream Meet class (📤 Send position button in ClassV2). Three
// vertical tabs on the left: Online class (received packs, default), My
// notes (placeholder for Phase 2 personal notes), Revise (placeholder for
// Phase 2 replay-and-score). Coach who sent a pack sees it here too, with a
// "you sent this" chip, so they can review the same list students see.
//
// Data comes from /api/me/notebook (all packs where I'm a recipient OR I'm
// the coach) and /api/notebook/:packId (full detail with history). See
// class-position-packs.controller.ts for the schema.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import { get } from "../lib/api";
import Board from "../components/Board";

type PackListItem = {
  _id: string;
  classId: string;
  classTitle: string;
  coachId: string;
  coachName: string;
  sentAt: string;
  title: string;
  startFen: string;
  cursorIdx: number;
  currentFen: string;
  recipientCount: number;
  sentByMe: boolean;
};
type PackListResp = { packs: PackListItem[] };
type PackDetail = PackListItem & { history: Array<{ from: string; to: string; promotion?: string }> };

// Group packs by calendar-day so the list reads as "Today · Yesterday · Aug
// 25" headers rather than one flat scroll — matches the notebook metaphor.
function groupByDay(packs: PackListItem[]): Array<{ key: string; label: string; items: PackListItem[] }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yday = new Date(today); yday.setDate(yday.getDate() - 1);
  const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
  const map = new Map<string, PackListItem[]>();
  for (const p of packs) {
    const d = new Date(p.sentAt); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const rows: Array<{ key: string; label: string; items: PackListItem[] }> = [];
  for (const [key, items] of map) {
    const d = new Date(key);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Today";
    else if (d.getTime() === yday.getTime()) label = "Yesterday";
    else label = fmt.format(d);
    rows.push({ key, label, items });
  }
  return rows;
}

function PackMiniBoard({ fen }: { fen: string }) {
  return (
    <div className="w-full">
      <Board fen={fen} coordinates={false} viewOnly dests={new Map() as any} />
    </div>
  );
}

// Compact PGN preview — first ~8 plies from startFen/history. Numbering
// respects the starting FEN's move counter + side to move, so a pack from
// a setup position doesn't restart at "1.".
function pgnPreview(startFen: string, history: Array<{ from: string; to: string; promotion?: string }>, plies = 8): string {
  try {
    const c = new Chess(startFen);
    const parts: string[] = [];
    for (let i = 0; i < Math.min(history.length, plies); i++) {
      const m = history[i]!;
      const turn = c.turn();
      const num = Number(c.fen().split(" ")[5] || "1");
      const applied = c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
      if (!applied) break;
      if (turn === "w") parts.push(`${num}. ${applied.san}`);
      else if (parts.length === 0) parts.push(`${num}... ${applied.san}`);
      else parts.push(applied.san);
    }
    return parts.join(" ") + (history.length > plies ? " …" : "");
  } catch { return ""; }
}

function OnlineClassList({ packs }: { packs: PackListItem[] }) {
  const groups = useMemo(() => groupByDay(packs), [packs]);
  if (packs.length === 0) {
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-8 text-center">
        <div className="text-4xl">📭</div>
        <div className="mt-3 font-display text-lg text-white">No positions yet</div>
        <div className="mt-1 text-sm text-ink-400">
          When your coach clicks <span className="rounded bg-brand-500/20 px-1.5 py-0.5 font-mono text-brand-200">📤 Send position</span> during a live class, it'll land here.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 flex items-center gap-2">
            <div className="rounded-full bg-brand-500/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-brand-200">{g.label}</div>
            <div className="text-[11px] text-ink-500">{g.items.length} {g.items.length === 1 ? "position" : "positions"}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((p) => (
              <Link
                key={p._id}
                to={`/notebook/${p._id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-gradient-to-br from-ink-900 to-ink-950 shadow-lg transition hover:border-brand-500/50 hover:shadow-brand-500/10"
              >
                <div className="p-2">
                  <PackMiniBoard fen={p.currentFen} />
                </div>
                <div className="flex-1 border-t border-ink-800 bg-ink-900/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-sm font-bold text-white">{p.title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-400">
                        {p.sentByMe ? "You sent this" : `From ${p.coachName}`} · {p.classTitle}
                      </div>
                    </div>
                    {p.sentByMe && (
                      <span className="shrink-0 rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                        Sent
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
                    <span>{new Date(p.sentAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{p.recipientCount} student{p.recipientCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Placeholder({ icon, title, note }: { icon: string; title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-10 text-center">
      <div className="text-5xl">{icon}</div>
      <div className="mt-4 font-display text-lg text-white">{title}</div>
      <div className="mt-2 text-sm text-ink-400">{note}</div>
      <div className="mt-4 text-[11px] uppercase tracking-widest text-ink-500">Coming in Phase 2</div>
    </div>
  );
}

type Section = "online-class" | "my-notes" | "revise";
const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: "online-class", label: "Online class",  icon: "📚" },
  { id: "my-notes",     label: "My notes",      icon: "✍️" },
  { id: "revise",       label: "Revise",        icon: "🔁" },
];

export default function NotebookPage() {
  const [section, setSection] = useState<Section>("online-class");
  const { data, isLoading } = useQuery({
    queryKey: ["notebook"],
    queryFn: () => get<PackListResp>("/api/me/notebook"),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-white">📓 Notebook</h1>
        <div className="text-xs text-ink-500">
          Positions your coach shares from live classes land here.
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Left rail — 3 sections. Top three lines as the owner asked. */}
        <nav className="space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                section === s.id
                  ? "border-brand-500/60 bg-brand-500/15 text-white shadow-inner shadow-brand-500/20"
                  : "border-ink-800 bg-ink-900/50 text-ink-300 hover:border-ink-700 hover:bg-ink-800/60 hover:text-white"
              }`}
            >
              <span className="text-lg">{s.icon}</span>
              <span className="font-semibold">{s.label}</span>
              {s.id === "online-class" && data && (
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  data.packs.length > 0 ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-500"
                }`}>
                  {data.packs.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Main pane */}
        <div>
          {section === "online-class" && (
            isLoading ? (
              <div className="text-sm text-ink-500">Loading…</div>
            ) : (
              <OnlineClassList packs={data?.packs ?? []} />
            )
          )}
          {section === "my-notes" && (
            <Placeholder icon="✍️" title="Your personal chess notes" note="Jot down ideas, positions to remember, tactics you missed." />
          )}
          {section === "revise" && (
            <Placeholder icon="🔁" title="Revise received positions" note="Replay each pack move-by-move — score is added to the leaderboard." />
          )}
        </div>
      </div>
    </div>
  );
}

// Pack detail page — /notebook/:packId. Full board + full notation, "back
// to notebook" link. Phase 2 will layer revise mode + share-forward here.
export function NotebookPackDetailPage() {
  const { packId = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["notebook-pack", packId],
    queryFn: () => get<PackDetail>(`/api/notebook/${encodeURIComponent(packId)}`),
    enabled: !!packId,
  });

  const notation = useMemo(() => {
    if (!data) return [];
    const out: Array<{ ply: number; san: string; num: number; turn: "w" | "b" }> = [];
    try {
      const c = new Chess(data.startFen);
      for (let i = 0; i < data.history.length; i++) {
        const m = data.history[i]!;
        const turn = c.turn();
        const num = Number(c.fen().split(" ")[5] || "1");
        const applied = c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
        if (!applied) break;
        out.push({ ply: i + 1, san: applied.san, num, turn });
      }
    } catch { /* leave whatever we got */ }
    return out;
  }, [data]);

  if (isLoading) return <div className="p-8 text-sm text-ink-500">Loading…</div>;
  if (error || !data) return (
    <div className="p-8 text-center">
      <div className="text-4xl">🤔</div>
      <div className="mt-3 font-display text-lg text-white">Position not found</div>
      <div className="mt-1 text-sm text-ink-400">It may have been removed, or you might not have access.</div>
      <button onClick={() => navigate("/notebook")} className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">← Back to Notebook</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/notebook" className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">← Notebook</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold text-white">{data.title}</h1>
          <div className="mt-0.5 truncate text-xs text-ink-400">
            {data.sentByMe ? "You sent this" : `From ${data.coachName}`} · {data.classTitle} · {new Date(data.sentAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-ink-800 bg-ink-950/60 p-3 shadow-lg">
          <Board fen={data.currentFen} coordinates viewOnly dests={new Map() as any} />
          <div className="mt-2 truncate font-mono text-[10px] text-ink-500" title={data.currentFen}>{data.currentFen}</div>
        </div>
        <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Moves</div>
          <div className="mt-2 max-h-[420px] overflow-y-auto font-mono text-sm text-ink-100">
            {notation.length === 0 ? (
              <div className="text-xs text-ink-500">No moves — just the position.</div>
            ) : (
              notation.map((n) => (
                <span key={n.ply} className="mr-1.5">
                  {n.turn === "w" ? <span className="text-ink-500">{n.num}. </span> : (n.ply === 1 && <span className="text-ink-500">{n.num}… </span>)}
                  <span>{n.san}</span>
                </span>
              ))
            )}
          </div>
          <div className="mt-4 border-t border-ink-800 pt-3">
            <button
              disabled
              title="Revise mode ships in Phase 2 — replay this pack move-by-move and score to leaderboard"
              className="w-full cursor-not-allowed rounded-lg bg-ink-800 px-4 py-2 text-sm font-semibold text-ink-500"
            >
              🔁 Revise this position (soon)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
