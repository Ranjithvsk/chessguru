// Cross-academy READ scope for the ChessGuru super-admin.
//
// WHY THIS FILE EXISTS
// -------------------
// Owner ask (ranjith.vsk, 2026-09-11): "in all options need option to view all
// academy saved datas. now all academy leaderboard i can see, like that — study
// and online book, and other all i need option to view."
//
// The leaderboard (academy.service.ts buildLeaderboard) already does this by
// hand: an admin may pass ?academy=<slug|__all__|__platform__> and the roster is
// scoped to THAT academy instead of the caller's own. This module generalises
// that one-off into something studies / books / (later) the other ten services
// can share, WITHOUT touching `ensureCoachOrOwner`, `requireOwner` or the other
// 20-odd per-module guards that ~240 call sites depend on — most of which are
// writes.
//
// THE RULES, all three decided by the owner and NOT open for reinterpretation:
//
//   1. READ-ONLY. This resolver must only ever feed a read filter. Write paths
//      keep using the caller's own session.academyId, always. An admin must
//      never be able to assign homework, reset a rating, issue an invite,
//      change fees or mutate anything inside a paying customer's academy from
//      his own login. If you are about to pass a ReadScope to something that
//      inserts/updates/deletes/emails, stop — you are using the wrong tool.
//      (Note that three GETs in academy.service.ts — suspiciousSolves,
//      suspiciousDetail, listAchievementsFor — write as a side effect of being
//      read. They are reads in name only and must NOT be given an override.)
//   2. NO ACCESS LOGGING. Explicitly declined: "not need, its for developer
//      purpose". Don't add an audit trail here.
//   3. ADMIN ONLY, and silent. A coach or academy owner who passes
//      ?academy=<someone else's slug> gets their OWN academy back with no
//      error — never anything that reveals whether that academy exists.
//
// WHY A PLAIN FUNCTION AND NOT A NEST PROVIDER
// --------------------------------------------
// `src/admin/view-as.ts` already establishes this exact shape here: a plain
// exported function, no @Injectable, imported straight across module
// boundaries. src/lib is a verified leaf (nothing in it imports an app module,
// while 16 modules import ../lib/mail), and admin/admins.ts imports nothing at
// all — so lib/academy-scope.ts -> admin/admins.ts -> nothing is provably
// acyclic. Making this a method on AcademyService instead would drag
// FairplayService and FeesService into StudiesService's DI graph for what is a
// pure ten-line function.

import { UnauthorizedException } from "@nestjs/common";
import { Connection } from "mongoose";
import { isAdmin } from "../admin/admins";

/** Every academy at once — the fleet-wide view. Admin-only. */
export const ALL_ACADEMIES = "__all__";
/** Users with no academyId: self-signups on chessguru.cc. Admin-only. */
export const PLATFORM_BUCKET = "__platform__";
/** Display label for the no-academy bucket; matches the admin academy picker. */
export const PLATFORM_ACADEMY_LABEL = "ChessGuru (no academy)";

export interface ReadScope {
  /** Always the CALLER's own userId — never the viewed academy's anything. */
  userId: string;
  /** The academy to filter reads by. null when a sentinel bucket is active
   *  (check the flags first) or when the caller simply has no academy. */
  academyId: string | null;
  /** ?academy=__all__ by an admin: no academy constraint at all. */
  isAllAcademies: boolean;
  /** ?academy=__platform__ by an admin: rows with no academy. */
  isPlatformBucket: boolean;
  /** True only when an admin override actually took effect. Every caller uses
   *  this as the branch condition, so the no-override path stays byte-for-byte
   *  what it was before this file existed. */
  viewingOther: boolean;
}

/**
 * Resolve the academy a READ should be scoped to.
 *
 * Precedence, mirroring buildLeaderboard exactly:
 *   1. not signed in                      -> throw 401
 *   2. non-admin, or no ?academy=         -> session.academyId, as today
 *   3. admin + __all__ / __platform__     -> that sentinel, as flags
 *   4. admin + ?academy=<slug>            -> that slug
 *
 * Note the sentinels come back as BOOLEAN FLAGS with academyId = null, not as
 * the magic string. buildLeaderboard carries "__all__" forward as the value,
 * which is why `getActiveBoost("__all__")` and its badge $match both quietly
 * query for a literal academy called "__all__" and match nothing. Flags make
 * that class of bug unrepresentable: no caller can leak a sentinel into Mongo.
 *
 * Throws only when signed out (UnauthorizedException, the same class and
 * message studies/books already throw from their own ensureUser). A signed-in
 * caller with no academy is NOT an error here — studies and books both tolerate
 * academyId: null today and degrade to "just my own stuff". Making that throw
 * would be a behaviour change on an endpoint that works fine right now.
 */
export function resolveReadScope(session: any, opts: { academy?: string | null } = {}): ReadScope {
  const userId = session?.userId ? String(session.userId) : "";
  if (!userId) throw new UnauthorizedException("sign in first");
  const sessionAcademy: string | null = session?.academyId ?? null;
  // Express's qs parser will happily hand us an object or an array —
  // ?academy[$ne]=x gives {$ne:"x"}, ?academy=a&academy=b gives ["a","b"].
  // Reject anything that is not a plain string OUTRIGHT rather than coercing
  // it: String({}) is "[object Object]", which is harmless but only by
  // accident, and an override that silently means something the caller did not
  // write is the wrong shape for a security boundary. A non-string is treated
  // as no override at all.
  const raw = opts?.academy;
  const requested = typeof raw === "string" ? raw.trim() : "";

  // Non-admins: the param is ignored entirely. No error, no hint that it was
  // even read — their own academy comes back exactly as it does today.
  if (!requested || !isAdmin(userId)) {
    return { userId, academyId: sessionAcademy, isAllAcademies: false, isPlatformBucket: false, viewingOther: false };
  }
  if (requested === ALL_ACADEMIES) {
    return { userId, academyId: null, isAllAcademies: true, isPlatformBucket: false, viewingOther: true };
  }
  if (requested === PLATFORM_BUCKET) {
    return { userId, academyId: null, isAllAcademies: false, isPlatformBucket: true, viewingOther: true };
  }
  // A slug that matches no academy is deliberately NOT validated: it simply
  // selects nothing. Same tolerate-and-degrade behaviour the leaderboard has,
  // and it leaks no information about which academies exist.
  return { userId, academyId: requested, isAllAcademies: false, isPlatformBucket: false, viewingOther: true };
}

/**
 * The Mongo fragment that applies a ReadScope to a collection's academy field.
 * Spread it into a find() filter: `{ ...academyScopeFilter(scope), deletedAt: ... }`.
 *
 *   __all__      -> {}                                  (no constraint)
 *   __platform__ -> field is null or absent
 *   <slug>       -> { field: slug }
 *   no academy   -> treated as __platform__: a caller with no academy can only
 *                   legitimately match the no-academy rows.
 */
export function academyScopeFilter(scope: ReadScope, field = "academyId"): Record<string, any> {
  if (scope.isAllAcademies) return {};
  if (scope.isPlatformBucket || !scope.academyId) {
    return { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
  }
  return { [field]: scope.academyId };
}

/** In-JS twin of academyScopeFilter, for gating a doc already fetched by _id.
 *  MUST stay the exact predicate academyScopeFilter expresses in Mongo, or a
 *  doc can pass the list filter and fail the detail gate (or the reverse).
 *  The Mongo side matches null-or-absent ONLY, so "" is NOT no-academy here
 *  either — `!value` used to say it was. */
export function academyInScope(value: string | null | undefined, scope: ReadScope): boolean {
  if (scope.isAllAcademies) return true;
  if (scope.isPlatformBucket || !scope.academyId) return value === null || value === undefined;
  return value === scope.academyId;
}

/**
 * Resolve academy slugs to display names from the `academies` collection
 * (_id = slug, name = display name). Missing slugs fall back to the slug.
 */
export async function academyNameMap(conn: Connection, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = Array.from(new Set(ids.filter((x): x is string => !!x)));
  const map = new Map<string, string>();
  if (!want.length) return map;
  const rows = await conn.db!.collection("academies")
    .find({ _id: { $in: want as any } }, { projection: { _id: 1, name: 1 } })
    .toArray();
  for (const r of rows) map.set(String(r._id), String((r as any).name || r._id));
  for (const id of want) if (!map.has(id)) map.set(id, id);
  return map;
}

/**
 * Stamp `academyId` + `academyName` onto rows so a cross-academy list is
 * readable — without it the __all__ view is just an undifferentiated pile and
 * the caller cannot tell whose study is whose.
 *
 * ONLY call this on the override branch. Rows returned to a normal caller must
 * keep exactly the shape they have today.
 */
export async function attachAcademyNames<T extends Record<string, any>>(
  conn: Connection,
  rows: T[],
  field = "academyId",
): Promise<(T & { academyId: string | null; academyName: string })[]> {
  const names = await academyNameMap(conn, rows.map((r) => r?.[field] ?? null));
  return rows.map((r) => {
    const id: string | null = r?.[field] ?? null;
    return { ...r, academyId: id, academyName: id ? (names.get(id) ?? id) : PLATFORM_ACADEMY_LABEL };
  });
}
