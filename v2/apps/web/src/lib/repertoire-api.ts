// Thin fetch wrappers for /api/my/repertoire — the server-side "My
// Repertoire" store (see saved-lines.controller.ts). Two entry kinds:
//   * "corpus"  — bookmark of a named ECO opening (`slug`)
//   * "line"    — hand-played move sequence (`sans[]` + optional notes)
//
// Coaches can share their own entries (POST /api/my/repertoire/:id/share)
// or push straight to one student (POST /api/my/repertoire/push/:studentId).

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

/** A move-tree node — same shape as useFreePlay's MoveNode. `children[0]` is
 *  the mainline continuation from this node; extra children are sibling
 *  variations. Persisted so a saved "line" entry keeps every branch the
 *  student recorded, not just the mainline SAN sequence. */
export interface RepMoveNode {
  san: string;
  nag?: string;       // PGN glyph appended to SAN (!, ?, ±, +=, …)
  comment?: string;   // free-form coach text under the move
  children: RepMoveNode[];
}

export interface RepertoireEntry {
  _id: string;
  ownerId: string;
  kind: "corpus" | "line";
  name: string;
  slug?: string;
  sans?: string[];
  /** Optional full tree (with sidelines). When present, load THIS instead of
   *  `sans` so branches survive round-trip. */
  tree?: RepMoveNode[];
  /** Optional starting FEN — set when the coach saved this line from a
   *  custom SETUP position (mid-game, endgame study, etc.). When absent,
   *  the line replays from the standard opening. Loading callers must pass
   *  this fen to the position-replay so sans/tree land correctly. */
  startFen?: string;
  notes?: string | null;
  createdAt: string;
  sharedFrom?: string | null;
  sharedFromName?: string | null;
  /** Coach-set flag: this entry is required study. On the student side we
   *  auto-activate it into the Opening Trainer and hide the remove button
   *  in the training queue (owner ask 2026-08-20 — "coach can force-add
   *  to students' opening trainer; students can't remove those"). */
  forceTrain?: boolean;
}

async function jf(url: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${url}`, { credentials: "include", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `${r.status}`);
  return j;
}

export function listRepertoire(): Promise<{ entries: RepertoireEntry[] }> {
  return jf("/api/my/repertoire");
}
export function addRepertoire(body: {
  name: string; kind: "corpus" | "line"; slug?: string; sans?: string[]; tree?: RepMoveNode[]; notes?: string | null; startFen?: string;
}): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf("/api/my/repertoire", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export function deleteRepertoire(id: string): Promise<{ ok: boolean }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function updateRepertoire(id: string, patch: {
  name?: string; notes?: string | null; sans?: string[]; tree?: RepMoveNode[] | null; forceTrain?: boolean;
}): Promise<{ ok: boolean; changed: number; propagated: number; entry: RepertoireEntry }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}
export function duplicateRepertoire(id: string, name?: string): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/duplicate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  });
}
export function shareRepertoire(id: string, studentIds: string[], forceTrain = false): Promise<{ ok: boolean; shared: number }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/share`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentIds, forceTrain }),
  });
}
export function listRepertoireTrash(): Promise<{ entries: RepertoireEntry[] }> {
  return jf("/api/my/repertoire?trash=1");
}
export function restoreRepertoire(id: string): Promise<{ ok: boolean }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/restore`, { method: "POST" });
}
export interface RepertoireVersion {
  _id: string;
  entryId: string;
  ownerId: string;
  at: string;
  kind: "edit" | "delete" | "restore";
  by: string;
  snapshot: {
    name: string; kind: "corpus" | "line"; slug?: string | null;
    sans?: string[] | null; tree?: RepMoveNode[] | null; notes?: string | null;
    forceTrain?: boolean; startFen?: string | null;
  };
}
export function listRepertoireVersions(id: string): Promise<{ versions: RepertoireVersion[] }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/versions`);
}
export function rollbackRepertoire(id: string, versionId: string): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/rollback/${encodeURIComponent(versionId)}`, { method: "POST" });
}
export function pushToStudent(studentId: string, body: {
  name: string; kind: "corpus" | "line"; slug?: string; sans?: string[]; tree?: RepMoveNode[]; notes?: string | null;
}): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf(`/api/my/repertoire/push/${encodeURIComponent(studentId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
