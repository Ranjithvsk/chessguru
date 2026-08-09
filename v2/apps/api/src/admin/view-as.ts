import { Connection } from "mongoose";
import { isAdmin } from "./admins";

// "View as another user" resolver used by /me/* and dashboard endpoints.
// Precedence (returns first that grants):
//   1. platform admin (see admins.ts allowlist)  -> any user
//   2. academy_owner                             -> any user in their academy
//   3. coach                                     -> any student where coachId === self
//   4. otherwise / no ?as=                       -> the session's own userId
// Returns null when signed out. Requesting ?as=<u> that fails authz silently
// falls back to the caller's own userId (no info-leak on which users exist).
export async function resolveViewedUser(
  conn: Connection,
  session: any,
  asRaw: string | undefined | null,
): Promise<string | null> {
  const sessionUser: string | null = session?.userId ?? null;
  const as = String(asRaw ?? "").trim().toLowerCase();
  if (!as) return sessionUser;

  const users = conn.db!.collection("users");

  // 1) Platform admin -- any user
  if (isAdmin(sessionUser)) {
    const doc = await users.findOne({ _id: as as any }, { projection: { _id: 1 } });
    return doc ? String(doc._id) : sessionUser;
  }

  if (!sessionUser) return null;
  const role = session?.role;
  const academyId = session?.academyId;

  // 2) Academy owner -- any user in their academy
  if (role === "academy_owner" && academyId) {
    const doc = await users.findOne({ _id: as as any, academyId }, { projection: { _id: 1 } });
    return doc ? String(doc._id) : sessionUser;
  }

  // 3) Coach -- only students whose coachId is this coach
  if (role === "coach" && academyId) {
    const doc = await users.findOne(
      { _id: as as any, academyId, role: "student", coachId: sessionUser },
      { projection: { _id: 1 } },
    );
    return doc ? String(doc._id) : sessionUser;
  }

  // 4) Everyone else -- no cross-user view
  return sessionUser;
}
