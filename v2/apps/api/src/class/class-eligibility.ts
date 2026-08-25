// Owner ask 2026-08-25: "sarika coach started online class, all students
// joined; only her students should be able to join."
//
// Central rule for "which students may join class X". Every place that
// gates access to a class (LiveKit token, live-now feed, going-live push,
// schedule list) calls this so the rule stays one-line consistent.
//
// Resolution order:
//   1. Class has an explicit batchStudentIds → use it (owner UI stamps this
//      when scheduling a cohort class).
//   2. Class was created by a `role: "coach"` user → students with
//      users.coachId === createdByUserId are eligible. Catches Sarika's
//      ad-hoc classes (no schedule row, no batch) where the only signal
//      we have is her identity.
//   3. Fallback (academy_owner-created broadcast, no batch) → null, meaning
//      "everyone in the academy" — preserves the legacy behaviour so
//      owner-scheduled all-academy classes still reach everyone.
//
// Returning null (not empty array) is deliberate: "no restriction" and
// "restricted to zero students" are different and must be checked
// separately at each caller. Empty array = block every student.

import type { Connection } from "mongoose";

export type Eligibility =
  | { restricted: false }                  // any student in academy may join
  | { restricted: true; studentIds: Set<string> };

/** Resolve who is allowed to join a given class. Callers pass the coach
 *  user id when they already know it (e.g. from classLiveAnnouncements)
 *  so we can skip a users lookup — otherwise this looks it up from the
 *  class doc. Never throws; on any error returns unrestricted so a Mongo
 *  hiccup never wedges live classes. */
export async function resolveEligibility(
  conn: Connection,
  classId: string,
  coachUserIdHint: string | null,
): Promise<Eligibility> {
  try {
    const db = conn.db!;
    const klass: any = await db.collection("classSchedules").findOne(
      { _id: classId as any },
      { projection: { createdByUserId: 1, batchStudentIds: 1, academyId: 1 } },
    );

    // 1. explicit batch list on the class doc wins
    if (klass && Array.isArray(klass.batchStudentIds) && klass.batchStudentIds.length > 0) {
      return { restricted: true, studentIds: new Set(klass.batchStudentIds.map(String)) };
    }

    // Resolve the coach user id: prefer the hint (from
    // classLiveAnnouncements for ad-hoc classes), else the schedule row.
    const coachId = coachUserIdHint || (klass?.createdByUserId ?? null);
    if (!coachId) return { restricted: false };

    // 2. If the creator is a coach role, restrict to their assigned students.
    const coachUser: any = await db.collection("users").findOne(
      { _id: coachId as any }, { projection: { role: 1 } },
    );
    if (coachUser?.role === "coach") {
      const rows: any[] = await db.collection("users")
        .find({ coachId, role: "student" }, { projection: { _id: 1 } })
        .toArray();
      return { restricted: true, studentIds: new Set(rows.map((r) => String(r._id))) };
    }

    // 3. Owner (or unknown) created it → open to whole academy.
    return { restricted: false };
  } catch {
    return { restricted: false };
  }
}

/** True when `studentId` (a user with role "student") is allowed to join
 *  the class per resolveEligibility. Non-restricted classes return true. */
export function isStudentEligible(elig: Eligibility, studentId: string | null | undefined): boolean {
  if (!elig.restricted) return true;
  if (!studentId) return false;
  return elig.studentIds.has(String(studentId));
}
