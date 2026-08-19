// Thin fetch wrappers for /api/my/repertoire — the server-side "My
// Repertoire" store (see saved-lines.controller.ts). Two entry kinds:
//   * "corpus"  — bookmark of a named ECO opening (`slug`)
//   * "line"    — hand-played move sequence (`sans[]` + optional notes)
//
// Coaches can share their own entries (POST /api/my/repertoire/:id/share)
// or push straight to one student (POST /api/my/repertoire/push/:studentId).

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

export interface RepertoireEntry {
  _id: string;
  ownerId: string;
  kind: "corpus" | "line";
  name: string;
  slug?: string;
  sans?: string[];
  notes?: string | null;
  createdAt: string;
  sharedFrom?: string | null;
  sharedFromName?: string | null;
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
  name: string; kind: "corpus" | "line"; slug?: string; sans?: string[]; notes?: string | null;
}): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf("/api/my/repertoire", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export function deleteRepertoire(id: string): Promise<{ ok: boolean }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function shareRepertoire(id: string, studentIds: string[]): Promise<{ ok: boolean; shared: number }> {
  return jf(`/api/my/repertoire/${encodeURIComponent(id)}/share`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentIds }),
  });
}
export function pushToStudent(studentId: string, body: {
  name: string; kind: "corpus" | "line"; slug?: string; sans?: string[]; notes?: string | null;
}): Promise<{ ok: boolean; entry: RepertoireEntry }> {
  return jf(`/api/my/repertoire/push/${encodeURIComponent(studentId)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
