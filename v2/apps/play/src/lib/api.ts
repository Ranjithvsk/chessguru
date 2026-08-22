// Thin fetch wrappers around the /v2api/* endpoints. nginx routes /v2api/*
// on play.chessguru.cc → localhost:4000 (chessguru-v2-api NestJS).
const BASE = "/v2api";

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}
async function jpost<T>(path: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return r.json();
}

// Public
export const listTournaments = (q?: Record<string, string>) =>
  jget<{ rows: any[]; total: number }>(`/api/play/tournaments${q ? "?" + new URLSearchParams(q) : ""}`);
export const getTournament = (id: string) =>
  jget<any>(`/api/play/tournament?id=${encodeURIComponent(id)}`);
export const feed = (params: Record<string, any>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
  return jget<{ rated: any[]; nearby: any[]; total: number }>(`/api/play/me/feed?${q}`);
};
export const geolocatePincode = (pincode: string) =>
  jpost<any>("/api/play/geolocate", { pincode });
export const submitTournament = (body: any) =>
  jpost<any>("/api/play/submissions", body);

// Me / auth
export const me = () => jget<{ loggedIn: boolean; userId?: string; username?: string }>("/api/play/me");

// Favorites
export const listFavorites = () => jget<{ rows: any[] }>("/api/play/me/favorites");
export const toggleFavorite = (id: string) => jpost<{ ok: boolean; favorited?: boolean; error?: string }>(`/api/play/favorites/${encodeURIComponent(id)}`);

// Rating recommendations (per player)
export const ratingRecs = () => jget<{ players: any[] }>("/api/play/me/rating-recs");

// Players
export const listPlayers = () => jget<{ rows: any[] }>("/api/play/me/players");
export const createPlayer = (body: any) => jpost<{ ok: boolean; id?: string; error?: string }>("/api/play/me/players", body);
export const editPlayer = (id: string, body: any) => jpost<{ ok: boolean; error?: string }>(`/api/play/me/players/${encodeURIComponent(id)}/edit`, body);
export const deletePlayer = (id: string) => jpost<{ ok: boolean }>(`/api/play/me/players/${encodeURIComponent(id)}`, undefined, "DELETE");

// Connect (WhatsApp for academies)
export const connectConfig = () => jget<any>("/api/connect/me/config");
export const connectStats  = () => jget<any>("/api/connect/me/stats");
export const connectInbox  = () => jget<{ rows: any[] }>("/api/connect/me/inbox");
export const connectConversation = (phone: string) => jget<{ messages: any[] }>(`/api/connect/me/conversations/${encodeURIComponent(phone)}`);
export const connectSend = (body: any) => jpost<any>("/api/connect/me/send", body);
export const connectContacts = () => jget<{ rows: any[] }>("/api/connect/me/contacts");
export const connectContactsAdd = (body: any) => jpost<any>("/api/connect/me/contacts", body);

// Admin
export const adminStats = () => jget<any>("/api/play/admin/stats");
export const adminList = (q?: Record<string, string>) =>
  jget<{ rows: any[]; total: number }>(`/api/play/admin/tournaments${q ? "?" + new URLSearchParams(q) : ""}`);
export const adminVerify = (id: string) => jpost(`/api/play/admin/tournaments/${encodeURIComponent(id)}/verify`);
export const adminHide   = (id: string) => jpost(`/api/play/admin/tournaments/${encodeURIComponent(id)}/hide`);
export const adminUnhide = (id: string) => jpost(`/api/play/admin/tournaments/${encodeURIComponent(id)}/unhide`);
export const adminDelete = (id: string) => jpost(`/api/play/admin/tournaments/${encodeURIComponent(id)}`, undefined, "DELETE");
export const adminOutreach = () => jget<{ rows: any[] }>("/api/play/admin/organizer-outreach");
export const adminOutreachMark = (phone: string, body: any) => jpost(`/api/play/admin/organizer-outreach/${encodeURIComponent(phone)}/mark`, body);
export const adminOutreachSend = (phone: string, body: any = {}) => jpost<any>(`/api/play/admin/outreach/${encodeURIComponent(phone)}/send`, body);
export const adminOutreachBatchSend = (body: any) => jpost<any>(`/api/play/admin/outreach/batch-send`, body);
