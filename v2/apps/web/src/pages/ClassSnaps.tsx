// /class-v2/:room/snaps — lists every snap the coach has captured mid-class,
// with a mini board thumbnail (viewOnly) + note + timestamp. Backed by
// GET /api/class/:id/snaps (see class-snap.controller.ts). Read-only page —
// deletion/editing lives inside the coach's academy dashboard.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import Board from "../components/Board";

type Snap = {
  _id: string;
  classId: string;
  fen: string;
  note?: string;
  byName?: string;
  at: string;
  hasAudio?: boolean;
};

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export default function ClassSnapsPage() {
  const { room = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["class-snaps", room],
    queryFn: () => get<{ snaps: Snap[] }>(`/api/class/${encodeURIComponent(room)}/snaps`),
    enabled: !!room,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">📸 Class snaps</h1>
          <p className="text-sm text-ink-400">Board positions captured during <b className="text-ink-100">{room}</b>.</p>
        </div>
        <Link to={`/class-v2/${encodeURIComponent(room)}?role=coach`}
          className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-ink-700">
          ← Back to class
        </Link>
      </div>

      {isLoading && <div className="py-16 text-center text-ink-400">Loading snaps…</div>}
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          Could not load snaps: {String((error as any)?.message || error)}
        </div>
      )}
      {data && data.snaps.length === 0 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-8 text-center text-sm text-ink-400">
          No snaps yet — hit 📸 during a live class to save a position.
        </div>
      )}
      {data && data.snaps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.snaps.map((s) => (
            <div key={s._id} className="rounded-xl border border-ink-700 bg-ink-900/70 p-3 shadow">
              <div className="mb-2 overflow-hidden rounded-lg" style={{ aspectRatio: "1" }}>
                <Board fen={s.fen} viewOnly coordinates={false} />
              </div>
              <div className="flex items-center justify-between text-[10px] text-ink-500">
                <span>{s.byName || "coach"}</span>
                <span>{new Date(s.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
              {s.note && <div className="mt-1 text-xs text-ink-200">{s.note}</div>}
              {s.hasAudio && <div className="mt-1 text-[10px] text-emerald-400">🎙 audio attached</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
