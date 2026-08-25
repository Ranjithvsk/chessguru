// Audience picker — opens once when a coach lands in a Dream Meet room that
// hasn't had an audience picked yet. Coach chooses ONE of:
//   * Batch (dropdown of coach's batches)
//   * All my students (default)
//   * Individual students (multi-select)
// Only the picked audience can join the WS room (enforced on hello in
// class-ws.ts) AND only they receive the "class is live" push (fired by
// PATCH /api/class/:id/audience). Owner ask 2026-08-25.
import { useEffect, useMemo, useState } from "react";
import { get, patch } from "../lib/api";

type Batch    = { _id: string; name: string; memberCount: number };
type Student  = { _id: string; name: string };
type Audience = {
  audienceKind: "batch" | "coach_students" | "individuals" | "academy" | null;
  audienceBatchId: string | null;
  batchStudentIds: string[] | null;
  batches: Batch[];
  students: Student[];
};
type Kind = "batch" | "coach_students" | "individuals";

export default function AudiencePickerModal(props: {
  room: string;
  onDone: (result: { audienceCount: number; notified: number }) => void;
  onClose: () => void;
  title?: string;
}) {
  const { room, onDone, onClose } = props;
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  const [data, setData]           = useState<Audience | null>(null);
  const [kind, setKind]           = useState<Kind>("coach_students");
  const [batchId, setBatchId]     = useState<string>("");
  const [picked, setPicked]       = useState<Set<string>>(new Set());
  const [studentQuery, setQ]      = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await get<Audience>(`/api/class/${encodeURIComponent(room)}/audience`);
        if (cancelled) return;
        setData(d);
        // Pre-select whatever's already there so re-opening picks up the
        // current audience instead of resetting to defaults.
        if (d.audienceKind === "batch" && d.audienceBatchId) {
          setKind("batch");
          setBatchId(d.audienceBatchId);
        } else if (d.audienceKind === "individuals" && Array.isArray(d.batchStudentIds)) {
          setKind("individuals");
          setPicked(new Set(d.batchStudentIds));
        } else {
          setKind("coach_students");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load audience options");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [room]);

  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!data) return [];
    if (!q) return data.students;
    return data.students.filter((s) => s.name.toLowerCase().includes(q));
  }, [data, studentQuery]);

  const previewCount = useMemo(() => {
    if (!data) return 0;
    if (kind === "coach_students") return data.students.length;
    if (kind === "batch") return data.batches.find((b) => b._id === batchId)?.memberCount ?? 0;
    return picked.size;
  }, [data, kind, batchId, picked]);

  const canSubmit =
    !saving && data != null && (
      (kind === "coach_students" && data.students.length > 0) ||
      (kind === "batch" && batchId.length > 0) ||
      (kind === "individuals" && picked.size > 0)
    );

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true); setErr(null);
    try {
      const body: any = { kind, notify: true };
      if (kind === "batch") body.batchId = batchId;
      if (kind === "individuals") body.studentIds = [...picked];
      const res = await patch<{ ok: boolean; audienceCount: number; notified: number; error?: string }>(
        `/api/class/${encodeURIComponent(room)}/audience`, body);
      if (!res.ok) { setErr(res.error || "Server refused audience change"); setSaving(false); return; }
      onDone({ audienceCount: res.audienceCount, notified: res.notified });
    } catch (e: any) {
      setErr(e?.message || "Failed to save audience");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 sm:items-center"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      tabIndex={-1}
    >
      <div className="my-auto w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-800 bg-ink-800/60 px-4 py-2.5">
          <div className="font-display text-base font-bold text-white">🎯 Who can join this class?</div>
          <button
            onClick={onClose}
            title="Close (audience unchanged)"
            className="rounded-md p-1 text-xl leading-none text-ink-400 hover:bg-ink-700 hover:text-white"
          >×</button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-ink-400">Loading options…</div>
        ) : !data ? (
          <div className="p-6 text-center text-sm text-rose-400">{err || "Could not load"}</div>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-xs text-ink-400">
              Only these people can enter the room, and only they get the
              &quot;class is live&quot; notification. You can change this later.
            </p>

            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-ink-700 bg-ink-950 p-1">
              <TabBtn active={kind === "coach_students"} onClick={() => setKind("coach_students")}>
                All my students
                <div className="text-[10px] text-ink-500">{data.students.length}</div>
              </TabBtn>
              <TabBtn active={kind === "batch"} onClick={() => setKind("batch")}>
                Batch
                <div className="text-[10px] text-ink-500">{data.batches.length} batch{data.batches.length === 1 ? "" : "es"}</div>
              </TabBtn>
              <TabBtn active={kind === "individuals"} onClick={() => setKind("individuals")}>
                Pick people
                <div className="text-[10px] text-ink-500">{picked.size} selected</div>
              </TabBtn>
            </div>

            {kind === "coach_students" && (
              <div className="rounded-lg border border-ink-800 bg-ink-950 p-3 text-sm text-ink-200">
                Everyone assigned to you as a student — {data.students.length} people.
                {data.students.length === 0 && (
                  <div className="mt-1 text-xs text-amber-300">You have no assigned students yet. Try &quot;Batch&quot; or &quot;Pick people&quot;.</div>
                )}
              </div>
            )}

            {kind === "batch" && (
              <div className="space-y-2">
                {data.batches.length === 0 ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                    You don&apos;t have any batches yet. Create one from the Academy → Batches page, or pick people below.
                  </div>
                ) : (
                  <select
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                    className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">— pick a batch —</option>
                    {data.batches.map((b) => (
                      <option key={b._id} value={b._id}>{b.name} ({b.memberCount})</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {kind === "individuals" && (
              <div className="space-y-2">
                <input
                  value={studentQuery}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search students…"
                  className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none"
                />
                <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950">
                  {filteredStudents.length === 0 ? (
                    <div className="p-3 text-xs text-ink-500">No students match.</div>
                  ) : filteredStudents.map((s) => (
                    <label key={s._id}
                      className="flex cursor-pointer items-center gap-2 border-b border-ink-800 px-3 py-2 text-sm text-ink-100 last:border-b-0 hover:bg-ink-900">
                      <input
                        type="checkbox"
                        checked={picked.has(s._id)}
                        onChange={(e) => {
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(s._id);
                            else next.delete(s._id);
                            return next;
                          });
                        }}
                        className="h-4 w-4 accent-brand-500"
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {err && <div className="text-xs text-rose-400">{err}</div>}

            <div className="flex items-center justify-between border-t border-ink-800 pt-3">
              <div className="text-xs text-ink-400">
                Will invite <span className="font-bold text-brand-200">{previewCount}</span> {previewCount === 1 ? "person" : "people"}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-200 hover:bg-ink-700"
                >Skip</button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Sending…" : "Start & notify"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${active ? "bg-brand-500 text-white" : "text-ink-300 hover:bg-ink-800"}`}
    >
      {children}
    </button>
  );
}
