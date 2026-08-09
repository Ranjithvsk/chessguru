import { Connection } from "mongoose";
import { isAdmin } from "./admins";

// Admin-only "view as another user" resolver used by /me/* and dashboard.
// Returns the userId whose data we should surface for THIS request:
//   * signed-in admin + valid ?as=<u> param whose account exists -> that user's _id
//   * otherwise -> the session's own userId (or null if signed out)
export async function resolveViewedUser(
  conn: Connection,
  session: any,
  asRaw: string | undefined | null,
): Promise<string | null> {
  const sessionUser: string | null = session?.userId ?? null;
  const as = String(asRaw ?? "").trim().toLowerCase();
  if (!as || !isAdmin(sessionUser)) return sessionUser;
  const doc = await conn.db!.collection("users").findOne({ _id: as as any }, { projection: { _id: 1 } });
  return doc ? String(doc._id) : sessionUser;
}
