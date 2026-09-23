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
      { projection: { createdByUserId: 1, batchStudentIds: 1, academyId: 1, audienceKind: 1, roomKind: 1, createdFrom: 1 } },
    );

    // 0. An ad-hoc Dream Meet room whose audience has NEVER been picked admits
    //    NOBODY. Going live writes the classSchedules row immediately, on
    //    purpose, so the class is real and can be ended — but it is written with
    //    audienceKind unset, and until the coach chooses, rule 2 below would hand
    //    the room to EVERY student assigned to that coach.
    //
    //    The student live-now banner already hid such a room (2026-08-25 round 3)
    //    and going-live already withholds the push (round 2), so this was believed
    //    closed — the comment at the creation site still says "the student-facing
    //    gate still requires an audience to be picked". It did not. The BANNER
    //    did. The join gates — the LiveKit token and the class socket — both call
    //    straight through to rule 2, so anyone holding the room link (a bookmark,
    //    a link from the coach's previous class, a second device) could walk in
    //    before the coach had chosen who the class was for.
    //    (owner, 2026-09-21: "before selecting, all students ... can join why?")
    //
    //    Scoped to roomKind "meet" deliberately: a SCHEDULED class legitimately
    //    carries no audienceKind and relies on rule 3 to reach the whole academy,
    //    and blocking those would break every all-academy broadcast.
    const audiencePicked = !!klass && (
      !!klass.audienceKind ||
      (Array.isArray(klass.batchStudentIds) && klass.batchStudentIds.length > 0)
    );
    //    NOT applied to rows auto-created when somebody joined a hand-typed
    //    room id (class-ws ensureClassRow). Those rooms never had an
    //    audience-picking step to skip: before they got a row at all they fell
    //    straight through to rule 2/3, and writing one purely so the class shows
    //    up in the log must not quietly lock every student out of a room that
    //    worked yesterday. The marker keeps the two concerns apart.
    //    "join" = written by class-ws when someone walked in; "backfill" = the
    //    same rooms, reconstructed from attendance for classes taught before
    //    that existed. Both mean "nobody ever picked an audience for this room
    //    because there was no step at which to pick one".
    const autoCreated = klass?.createdFrom === "join" || klass?.createdFrom === "backfill";
    if (klass && klass.roomKind === "meet" && !audiencePicked && !autoCreated) {
      return { restricted: true, studentIds: new Set<string>() };   // empty set = block every student
    }

    // 0b. An auto-created room is one somebody reached by typing or bookmarking
    //     its id. Nobody ever picked an audience for it, so it used to fall
    //     through to rule 3 and stand open to every signed-in user who could
    //     guess the id — across academies, since the socket checks none.
    //
    //     Restricted now to people with an actual reason to be there: the
    //     coach's own students, PLUS anyone already on this room's attendance
    //     roster. The roster clause is not decoration — measured across the 73
    //     backfilled rooms, three of them contain five students who are NOT
    //     assigned to the coach running them, so coaches do teach outside their
    //     roster and a plain rule-2 restriction would have ejected real
    //     attendees from rooms they had been using for weeks.
    //
    //     Two corrections, 2026-09-23. The clause below read `role === "coach"`
    //     literally, so a room opened by an ACADEMY_OWNER matched nothing and fell
    //     through to the attendance roster alone — and since the roster is written
    //     only AFTER this gate passes (class-ws records the join downstream of it),
    //     a student who had never been in that particular room could not get in and
    //     could not get on the roster by getting in. A closed loop. It bit hardest
    //     where it shows least: 53 of the 77 auto-created rooms on this install
    //     belong to one academy_owner, and every student new to one of those rooms
    //     was refused at the door, having seen the board first — the snapshot goes
    //     out at connect, before hello runs this check. Rule 3 below already says an
    //     owner's class is open to their academy; this now agrees with it.
    if (klass && autoCreated) {
      const allowed = new Set<string>();
      const creator = klass.createdByUserId ? String(klass.createdByUserId) : null;
      if (creator) {
        const cu: any = await db.collection("users").findOne(
          { _id: creator as any }, { projection: { role: 1, academyId: 1 } });
        if (cu?.role === "coach") {
          const rows: any[] = await db.collection("users")
            .find({ coachId: creator, role: "student" }, { projection: { _id: 1 } }).toArray();
          for (const r of rows) allowed.add(String(r._id));
        } else if (cu?.role === "academy_owner") {
          // An owner teaches the whole academy, not a roster assigned to them.
          const acad = klass.academyId ?? cu.academyId ?? null;
          if (acad) {
            const rows: any[] = await db.collection("users")
              .find({ academyId: acad, role: "student" }, { projection: { _id: 1 } }).toArray();
            for (const r of rows) allowed.add(String(r._id));
          }
        }
      }
      const seen: any[] = await db.collection("classAttendance")
        .find({ classId, userId: { $ne: null } }, { projection: { userId: 1 } }).toArray();
      for (const r of seen) if (r.userId) allowed.add(String(r.userId));
      //     An EMPTY set is not an audience of nobody, it is a failure to work out
      //     who the audience is — creator missing, role unrecognised, no academy, no
      //     history. Everywhere else in this resolver that ends in not-knowing falls
      //     open to the academy (rule 3, and both catch blocks), because locking
      //     people out of their own lesson is the worse error. Blocking on empty was
      //     the deadlock's second half, and it would have come back for any role the
      //     clauses above do not name.
      //
      //     Note this is deliberately NOT fixed by recording attendance before the
      //     gate. That would put every socket that merely connected onto the roster,
      //     and the roster grants entry — one refused visit would buy permanent
      //     access, which is the opposite of what the gate is for.
      if (allowed.size === 0) return { restricted: false };
      return { restricted: true, studentIds: allowed };
    }

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
