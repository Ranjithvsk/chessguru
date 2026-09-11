// ============================================================================
// Per-academy adoption & retention view (2026-09-11, owner ask: ranjith.vsk).
//
// "The gap is a per-academy activity view: for one academy, who is active, how
//  often, and what they are making. For four tenants that gap is manageable. It
//  stops being manageable at twenty, when you will want to know which academies
//  are actually using the product and which signed up and went quiet."
//
// This is a RETENTION view for the person who sells the product. It is not a
// leaderboard and it deliberately does NOT rank by student count — a week-old
// academy using the product every day must read differently from a big one that
// has gone silent.
//
// READ-ONLY. No writes anywhere in this file.
//
// This file is the ONE implementation. A second, rival implementation lived in
// admin.service.ts as academyHealth()/academyDetail() behind /admin/academy-health;
// it was deleted on 2026-09-11 and everything it did better was folded in here:
// feature labels + an `applicable` flag, week-on-week deltas, the 30-day
// sparkline on the roll-up row, per-person puzzle ratings, the pre-signup
// shading on the drill-down chart, the merged "recently created" feed, and
// attention-first sort tiering. Do not re-bolt a report onto the shared service.
//
// -- Things that were verified against the live DB before this was written, and
//    that will silently produce confident wrong numbers if "cleaned up" --------
//   * `classSessions`, `classRooms`, `coachNotes` DO NOT EXIST. Mongo returns an
//     empty cursor, not an error, so anything built on them renders "0 classes"
//     for every academy including Guna, which has run 53. Real collection is
//     `classSchedules`.
//   * `feeInvoices` (camelCase) EXISTS and is EMPTY. The real one is snake_case
//     `fees_invoices`. Wiring fees to the camelCase name reports Rs 0 for the
//     single heaviest user on the platform.
//   * `users.lastSeenAt` DOES NOT EXIST on any of the 121 users. The real fields
//     are `lastSeen` (a 60s presence heartbeat) and `lastLogin`. `lastSeenAt` IS
//     a real field on `classAttendance`, which is where the belief came from.
//     The third clock is `sessions`: express-session runs rolling:true, so
//     `expires - maxAge` is the last request that account made. It has a hard
//     30-day horizon and is therefore a fallback, never the only source.
//   * `rounds` / `study_rounds` have NO academyId and NO userId. `_id` is
//     "<userId>:<puzzleId>" — split on the first ':' (same idiom as
//     admin.service.ts:100).
//   * `live_games` players are "u:<userId>" — the `u:` prefix is mandatory.
//   * `myGames` / `myRepertoire` key on `ownerId`, NOT `userId`.
//   * academies._id, users._id, studies._id and academyBatches._id are STRINGS.
//     Never wrap them in `new ObjectId()`, and never sort them as a proxy for
//     time — a random string id sorts lexicographically, not chronologically.
//     Every "recent" list here sorts on a real date field.
//
// -- Metrics deliberately NOT computed, because the data cannot support them ---
//   * Fees COLLECTED / payment rate. `fees_payments` is empty platform-wide and
//     every invoice is SENT with paidPaise 0 — it is Rs 0 / 0% for everyone. We
//     report BILLED and stop.
//   * Homework completion RATE. Guna is 7/243 (2.9%), Shriguru 1/1 (100%) — the
//     ratio ranks the light user 34x above the heavy one. Assigned and completed
//     are reported as two separate counts, never as a ratio.
//   * Weekly-actives / members. Small new tenants trivially hit 100% because no
//     account has had time to drift. Absolute counts only.
//   * academyBadges / milestones as engagement — both are auto-awarded as a side
//     effect of solving puzzles, so they are `rounds` wearing a hat.
// ============================================================================

import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { isAdmin } from "./admins";

/* ----------------------------------------------------------------- config -- */

const DAY_MS = 86_400_000;
/** All day buckets are IST — this is an India product and "today" must mean the
 *  owner's today, not UTC's. Mongo-side bucketing uses timezone "Asia/Kolkata";
 *  JS-side bucketing shifts by the same offset. Keep the two in step. */
const IST_OFFSET_MS = 5.5 * 3_600_000;
const IST_TZ = "Asia/Kolkata";

/** Sentinel rows kept for backward compatibility with the super-admin
 *  leaderboard picker (apps/web/src/pages/Leaderboard.tsx:391), which reads this
 *  endpoint as a bare array of { id, name, studentCount }. Both sentinels and
 *  the array shape must survive; every adoption field is additive. */
const ALL_ID = "__all__";
const STANDALONE_ID = "__platform__";

const ROLLUP_DEFAULT_LIMIT = 200;
const ROLLUP_MAX_LIMIT = 500;
const PEOPLE_DEFAULT_LIMIT = 100;
const PEOPLE_MAX_LIMIT = 500;
const RECENT_DEFAULT_LIMIT = 40;
const RECENT_MAX_LIMIT = 200;

/** ONE definition of "this week", used by the roll-up card, the drill-down
 *  people table, the sparkline and the health verdict alike: the last 7 IST
 *  CALENDAR days, today included. Not a rolling 168-hour window — the two
 *  disagree by up to a day and rendering both side by side is how the same
 *  label ends up meaning two things. The UI says "last 7 days (IST)". */
const WEEK_DAYS = 7;
const SERIES_DAYS = 30;
/** The bounded window every per-day scan of `rounds` / `study_rounds` is
 *  clamped to. Must cover SERIES_DAYS + the previous week + slack for clock
 *  skew. See solvesWindow() for why the match shape matters. */
const WINDOW_DAYS = 45;

/** Roll-up + drill-down share one snapshot. The legacy leaderboard picker hits
 *  the same route, so a page load must never pay for a fresh scan. */
const SNAPSHOT_TTL_MS = 120_000;
/** Lifetime totals need one pass over the whole of `rounds` (no date bound is
 *  possible — "before this academy existed" is a question about all of history),
 *  so they get their own, much longer cache and are reused across snapshots. */
const LIFETIME_TTL_MS = 900_000;

/* -------------------------------------------------------- feature catalogue -- */

/** One place for every feature key's human label and whether it can apply to a
 *  bucket that is not a tenant. The standalone bucket has no staff and no
 *  operations by definition; marking those chips `applicable: false` is the
 *  difference between "never used Classes" (a libel) and "not applicable". */
const FEATURE_META: Record<string, { label: string; academyOnly: boolean }> = {
  puzzles:          { label: "Puzzle solves",    academyOnly: false },
  studySolves:      { label: "Study solves",     academyOnly: false },
  studies:          { label: "Studies",          academyOnly: false },
  classes:          { label: "Classes",          academyOnly: true  },
  homework:         { label: "Homework",         academyOnly: true  },
  exams:            { label: "Exams",            academyOnly: true  },
  attendance:       { label: "Attendance",       academyOnly: true  },
  play:             { label: "Play",             academyOnly: false },
  fees:             { label: "Fees",             academyOnly: true  },
  batches:          { label: "Batches",          academyOnly: true  },
  manualAttendance: { label: "Register marked",  academyOnly: true  },
  messaging:        { label: "Messaging",        academyOnly: true  },
  positionPacks:    { label: "Position packs",   academyOnly: true  },
  classChallenges:  { label: "Class challenges", academyOnly: true  },
  classMail:        { label: "Class mail",       academyOnly: true  },
  parentReports:    { label: "Parent reports",   academyOnly: true  },
  publicProfile:    { label: "Public profile",   academyOnly: true  },
  invites:          { label: "Invites",          academyOnly: true  },
  books:            { label: "Books",            academyOnly: false },
  externalGames:    { label: "Imported games",   academyOnly: false },
  myGames:          { label: "My games",         academyOnly: false },
  repertoire:       { label: "Repertoire",       academyOnly: false },
  revisions:        { label: "Revisions",        academyOnly: false },
};

/** The headline checklist. `puzzles` and `studySolves` are SEPARATE chips on
 *  purpose: they are separate numbers in the activity block and on the
 *  sparkline too, so one label never means two things. */
const FEATURE_KEYS = [
  "puzzles", "studySolves", "studies", "classes", "homework", "exams", "attendance", "play", "fees",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Operational = "this tenant has wired its real operations into the product".
 *  Independent of student count, which is exactly why it is the headline. */
const OPERATIONAL_KEYS = [
  "batches", "classes", "manualAttendance", "homework", "exams", "fees",
  "messaging", "positionPacks", "classChallenges", "classMail", "parentReports",
  "publicProfile", "invites",
] as const;

/** Individual = "people play chess here". High individual + near-zero
 *  operational is the 'signed up and went quiet' signature. `play` (not the
 *  never-marked "liveGames" key the first draft listed) is the live-game one. */
const INDIVIDUAL_KEYS = [
  "puzzles", "studySolves", "studies", "books", "externalGames", "play",
  "myGames", "repertoire", "revisions",
] as const;

export type HealthBand = "thriving" | "growing" | "starting" | "quiet" | "dormant" | "aggregate";

/** Lower = needs attention sooner. The page sorts ascending on this, because
 *  the point of the page is the tenant that is about to churn, not the one that
 *  is fine. `aggregate` is parked out of the way. */
const SEVERITY: Record<HealthBand, number> = {
  dormant: 0, quiet: 1, starting: 2, growing: 3, thriving: 4, aggregate: 9,
};

/* ------------------------------------------------------------------ types -- */

export interface FeatureUse {
  key: string;
  label: string;
  /** false = this feature cannot exist for this bucket (academy-only feature on
   *  the standalone-signups row). Renders as "n/a", never as "never used". */
  applicable: boolean;
  used: boolean;
  lastUsedAt: string | null;
  count: number;
  detail?: Record<string, number>;
}

export interface SparkPoint {
  date: string;
  puzzles: number;
  studySolves: number;
  /** Before the academy existed. Those solves are the students' personal
   *  history and are NOT credited to this academy anywhere on the page. */
  preSignup: boolean;
}

export interface AcademyAdoptionRow {
  /* -- identity ------------------------------------------------------------ */
  id: string;
  name: string;
  /** Legacy field the leaderboard picker reads. role:"student" only. */
  studentCount: number;
  kind: "academy" | "standalone" | "all";
  synthetic: boolean;
  ownerId: string | null;
  ownerName: string | null;
  plan: string | null;
  createdAt: string | null;
  ageDays: number | null;
  /** name matches /test/i, or 0 members and nothing ever created. Shown and
   *  flagged, never silently dropped — a future real tenant with "test" in its
   *  name must not vanish from the page. */
  isTest: boolean;
  testReason: string | null;
  /** Owner is a platform superadmin — the vendor's own sandbox, not a customer.
   *  Every "customers" headline on the page excludes these and reports them
   *  separately; including one corrupts the whole comparison. */
  isInternal: boolean;
  /** Set when this row could not be computed from its own data (e.g. an
   *  unparseable academies.createdAt). The card degrades; the page does not. */
  dataError: string | null;

  /* -- people -------------------------------------------------------------- */
  people: {
    students: number;
    coaches: number;
    parents: number;
    owners: number;
    other: number;
    total: number;
    /** Members who have EVER signed in (lastLogin, lastSeen or a live session).
     *  Guna's owner created 98 accounts and a chunk have never signed in once —
     *  undelivered passwords, a concrete fixable thing, invisible in a headcount. */
    everLoggedIn: number;
    neverLoggedIn: number;
    /** Current members who arrived here from another academy. Their earlier
     *  puzzle/study history stays with the academy where it happened. */
    joinedFromElsewhere: number;
    /** Accounts that have since LEFT this academy. Their activity from while
     *  they were here is still counted here — that is what this academy did. */
    departed: number;
    /** Members whose academyId points at an academy row that no longer exists.
     *  Parked in the standalone bucket rather than dropped on the floor. */
    orphaned: number;
  };

  /* -- activity ------------------------------------------------------------ */
  activity: {
    /** ONE window everywhere: the last 7 IST calendar days, today included. */
    activeUsers7d: number;
    activeUsersPrev7d: number;
    activeUsers30d: number;
    /** Puzzle solves (`rounds`) and study solves (`study_rounds`) are reported
     *  separately AND as an explicit sum. Nothing on this page adds them up
     *  behind a label that says only "solves". */
    puzzles7d: number;
    puzzlesPrev7d: number;
    puzzles30d: number;
    studySolves7d: number;
    studySolvesPrev7d: number;
    studySolves30d: number;
    solves7d: number;
    solvesPrev7d: number;
    solves30d: number;
    /** Solves credited to this academy over its whole life — i.e. inside the
     *  window during which the solver was a member. */
    puzzlesLifetime: number;
    studySolvesLifetime: number;
    /** Solves by CURRENT members that happened before they were members here
     *  (personal accounts predating the academy, or history from the academy
     *  they transferred out of). 44% of chess-guru's raw total. */
    puzzlesBeforeJoining: number;
    /** Everything attributable to this academy in the window: solves plus every
     *  timestamped artefact (studies, classes, homework, attendance, packs,
     *  invoices, exams, batches, messages, invites, games). */
    actions7d: number;
    actions30d: number;
    activeDays30: number;
    lastActivityAt: string | null;
    daysSinceLastActivity: number | null;
    /** The churn tripwire. Computed from staff-AUTHORED artefacts, never from
     *  logins — an owner who logs in and leaves is exactly the tenant you are
     *  trying to catch. */
    lastStaffActionAt: string | null;
    daysSinceStaffAction: number | null;
    /** Distinct IST days with >=1 staff-authored artefact, over a window of
     *  min(14, age). The age normalisation is what makes this fair to a
     *  week-old tenant. Distinct DAYS, not events, so one bulk import cannot
     *  fake a habit. */
    staffActionDays: number;
    staffActionWindowDays: number;
    /** Distinct current staff who have ever created anything. A tenant where
     *  only the owner ever acts is single-threaded and fragile. */
    activeStaff: number;
    staffTotal: number;
    /** Artefacts authored inside this tenant by a PLATFORM admin who is not one
     *  of its own staff — us, poking around. Excluded from every staff-habit
     *  number above so vendor traffic cannot make a dormant academy look alive. */
    vendorActions: number;
  };

  /* -- adoption ------------------------------------------------------------ */
  features: FeatureUse[];
  featuresUsed: number;
  featuresApplicable: number;
  featuresTotal: number;
  operational: { used: number; applicable: number; total: number; features: FeatureUse[] };
  individual: { used: number; applicable: number; total: number; features: FeatureUse[] };

  /* -- chart --------------------------------------------------------------- */
  /** 30 IST days, oldest first, ending today. Same days, same clamp and same
   *  definition of a day as the drill-down chart. */
  spark: SparkPoint[];

  /* -- verdict ------------------------------------------------------------- */
  health: { band: HealthBand; label: string; reason: string; severity: number; tier: number };
}

/* --------------------------------------------------------------- internals -- */

interface Ev {
  at: number;
  kind: string;
  actor: string | null;
  /** true when only staff can author this artefact, regardless of actor id. */
  staffOnly: boolean;
}

/** One stretch of time during which a user belonged to one bucket. `to` is
 *  Infinity for the current membership. A user who transferred has two. */
interface MemberWindow {
  bucketId: string;
  from: number;
  to: number;
  fromDay: string | null;
  toDay: string | null;
}

interface Bucket {
  id: string;
  academy: any | null;
  members: any[];
  /** Accounts that have left. Not counted in people.total, but their activity
   *  from while they were here still belongs to this academy. */
  pastMembers: any[];
  staffIds: Set<string>;
  memberIds: Set<string>;
  events: Ev[];
  featureCounts: Record<string, number>;
  featureLast: Record<string, number>;
  detail: Record<string, Record<string, number>>;
  /** Solves credited to this bucket, per IST day, already membership-clamped. */
  dayPuzzles: Map<string, number>;
  dayStudy: Map<string, number>;
  dayActive: Map<string, Set<string>>;
  /** classSchedules._id that actually ran (have >=1 attendance row). Scheduled
   *  != held: only 53 of Guna's 62 schedules have any attendance. */
  heldClasses: Set<string>;
  recent: {
    studies: any[];
    classes: any[];
    homework: any[];
    batches: any[];
    exams: any[];
    positionPacks: any[];
    invoices: any[];
  };
  vendorActions: number;
}

/** Per-user lifetime solve totals, plus one column per distinct membership-window
 *  boundary so any half-open interval [from, to) is (col[from] - col[to]). */
interface LifetimeSolves {
  at: number;
  cuts: number[];
  puzzles: Map<string, { n: number; last: number; cols: number[] }>;
  studies: Map<string, { n: number; last: number; cols: number[] }>;
}

interface Snapshot {
  at: number;
  now: number;
  rows: AcademyAdoptionRow[];
  buckets: Map<string, Bucket>;
  /** uid -> IST day -> solve count, RAW (not membership-clamped). The people
   *  table reports the person's own account activity. */
  puzzleDays: Map<string, Map<string, number>>;
  studyDays: Map<string, Map<string, number>>;
  puzzleLast: Map<string, number>;
  studyLast: Map<string, number>;
  puzzleTotal: Map<string, number>;
  studyTotal: Map<string, number>;
  userById: Map<string, any>;
  studiesByOwner: Map<string, number>;
  windows: Map<string, MemberWindow[]>;
  ratingByUser: Map<string, number>;
  /** uid -> last request seen by express-session (expires - maxAge). 30-day
   *  horizon: absence means "not in the last 30 days", never "never". */
  lastRequest: Map<string, number>;
  orphanAcademyOf: Map<string, string>;
  days: string[];
}

/* =========================================================================== */

@Injectable()
export class AdminAcademiesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private db() { return this.conn.db!; }

  /** Hand-rolled caches, same idiom as AdminService.statsCache. Both carry an
   *  in-flight promise so a burst of concurrent requests — the picker and this
   *  page load together on every admin navigation — shares ONE build instead of
   *  each paying for its own scan. */
  private snapCache: Snapshot | null = null;
  private snapInFlight: Promise<Snapshot> | null = null;
  private lifeCache: LifetimeSolves | null = null;
  private lifeInFlight: Promise<LifetimeSolves> | null = null;

  /* ------------------------------------------------------------- helpers -- */

  private istDay(v: any): string | null {
    const t = this.ts(v);
    if (!t) return null;
    return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** Every date in this file goes through here. A corrupt or unparseable value
   *  becomes 0, never a NaN that detonates in toISOString() later. */
  private ts(v: any): number {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  private iso(t: number | null | undefined): string | null {
    if (!t || !Number.isFinite(t) || t <= 0) return null;
    try { return new Date(t).toISOString(); } catch { return null; }
  }

  private daysSince(t: number | null, now: number): number | null {
    if (!t || t <= 0) return null;
    return Math.max(0, Math.floor((now - t) / DAY_MS));
  }

  /** The last `n` IST day strings, oldest first, ending today. */
  private recentDays(now: number, n: number): string[] {
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * DAY_MS + IST_OFFSET_MS).toISOString().slice(0, 10));
    return out;
  }

  private newBucket(id: string, academy: any | null): Bucket {
    return {
      id, academy, members: [], pastMembers: [], staffIds: new Set(), memberIds: new Set(), events: [],
      featureCounts: {}, featureLast: {}, detail: {},
      dayPuzzles: new Map(), dayStudy: new Map(), dayActive: new Map(),
      heldClasses: new Set(),
      recent: { studies: [], classes: [], homework: [], batches: [], exams: [], positionPacks: [], invoices: [] },
      vendorActions: 0,
    };
  }

  private mark(b: Bucket | undefined, key: string, at: number, n = 1) {
    if (!b) return;
    b.featureCounts[key] = (b.featureCounts[key] ?? 0) + n;
    if (at > (b.featureLast[key] ?? 0)) b.featureLast[key] = at;
  }

  private bump(b: Bucket | undefined, group: string, key: string, n = 1) {
    if (!b) return;
    const g = (b.detail[group] ||= {});
    g[key] = (g[key] ?? 0) + n;
  }

  private ev(b: Bucket | undefined, at: number, kind: string, actor: string | null, staffOnly = false) {
    if (!b || !at) return;
    b.events.push({ at, kind, actor: actor ? String(actor) : null, staffOnly });
  }

  private feature(b: Bucket, key: string, isStandalone: boolean, detailGroup?: string): FeatureUse {
    const meta = FEATURE_META[key] ?? { label: key, academyOnly: false };
    const applicable = !(isStandalone && meta.academyOnly);
    const count = applicable ? (b.featureCounts[key] ?? 0) : 0;
    const last = applicable ? (b.featureLast[key] ?? 0) : 0;
    const detail = applicable && detailGroup ? b.detail[detailGroup] : undefined;
    return {
      key, label: meta.label, applicable,
      used: count > 0,
      lastUsedAt: this.iso(last),
      count,
      ...(detail && Object.keys(detail).length ? { detail } : {}),
    };
  }

  private blankFeature(key: string): FeatureUse {
    const meta = FEATURE_META[key] ?? { label: key, academyOnly: false };
    return { key, label: meta.label, applicable: true, used: false, lastUsedAt: null, count: 0 };
  }

  /* -------------------------------------------------------- solve scans -- */

  /** `_id` is "<userId>:<puzzleId>". Same idiom as admin.service.ts overviewDash. */
  private static readonly UID_EXPR = { $arrayElemAt: [{ $split: ["$_id", ":"] }, 0] };

  /** Per-user per-IST-day solve counts, BOUNDED to the last WINDOW_DAYS.
   *
   *  The `w: { $in: [true, false] }` clause is not decoration: `rounds` has one
   *  compound index, { w: 1, d: -1 }, and `d` is not its prefix. Naming both
   *  values of the boolean turns what would be a full COLLSCAN into a two-bucket
   *  IXSCAN over the date range (verified with explain() on 2026-09-11 — the
   *  unbounded version was a confirmed COLLSCAN at 269 ms on 16k rows, and that
   *  ran on EVERY page load). Every window metric on this page — 7d, prev 7d,
   *  30d, the sparkline, active users, active days — comes out of this one scan. */
  private async solvesWindow(name: string, since: Date) {
    return this.db().collection(name).aggregate([
      { $match: { w: { $in: [true, false] }, d: { $gte: since } } },
      { $project: { uid: AdminAcademiesService.UID_EXPR, d: 1 } },
      { $group: {
          _id: { uid: "$uid", day: { $dateToString: { format: "%Y-%m-%d", date: "$d", timezone: IST_TZ } } },
          n: { $sum: 1 }, last: { $max: "$d" },
      } },
    ]).toArray();
  }

  /** Lifetime per-user totals plus one conditional column per membership-window
   *  boundary, so "solves while this person was a member of this academy" and
   *  "solves before they joined" are both exact without a second scan.
   *
   *  This pass cannot be date-bounded — "before the academy existed" is a
   *  question about all of history — so it is cached for LIFETIME_TTL_MS and
   *  shared across snapshots. If it fails, the previous (stale) answer is reused
   *  rather than 500ing the page. */
  private async lifetimeSolves(cuts: number[]): Promise<LifetimeSolves> {
    const fresh = this.lifeCache && Date.now() - this.lifeCache.at < LIFETIME_TTL_MS
      && cuts.length === this.lifeCache.cuts.length
      && cuts.every((c, i) => c === this.lifeCache!.cuts[i]);
    if (fresh) return this.lifeCache!;
    if (this.lifeInFlight) return this.lifeInFlight;

    const run = (async (): Promise<LifetimeSolves> => {
      const acc: Record<string, any> = { n: { $sum: 1 }, last: { $max: "$d" } };
      cuts.forEach((c, i) => {
        acc["c" + i] = { $sum: { $cond: [{ $gte: ["$d", new Date(c)] }, 1, 0] } };
      });
      const pass = async (name: string) => {
        const rows = await this.db().collection(name).aggregate([
          { $project: { uid: AdminAcademiesService.UID_EXPR, d: 1 } },
          { $group: { _id: "$uid", ...acc } },
        ]).toArray();
        const out = new Map<string, { n: number; last: number; cols: number[] }>();
        for (const r of rows) {
          out.set(String(r._id), {
            n: Number(r.n) || 0,
            last: this.ts(r.last),
            cols: cuts.map((_, i) => Number(r["c" + i]) || 0),
          });
        }
        return out;
      };
      const [puzzles, studies] = await Promise.all([pass("rounds"), pass("study_rounds")]);
      return { at: Date.now(), cuts, puzzles, studies };
    })();

    this.lifeInFlight = run;
    try {
      const out = await run;
      this.lifeCache = out;
      return out;
    } catch (err) {
      if (this.lifeCache) return this.lifeCache;      // degrade, never 500
      throw err;
    } finally {
      this.lifeInFlight = null;
    }
  }

  /** Solves inside one membership window, from the conditional columns. */
  private inWindow(rec: { n: number; cols: number[] } | undefined, cuts: number[], w: MemberWindow): number {
    if (!rec) return 0;
    const at = (t: number) => {
      if (!Number.isFinite(t) || t <= 0) return rec.n;
      const i = cuts.indexOf(t);
      return i < 0 ? 0 : (rec.cols[i] ?? 0);
    };
    const from = at(w.from);
    const to = Number.isFinite(w.to) ? at(w.to) : 0;
    return Math.max(0, from - to);
  }

  /* --------------------------------------------------------------- build -- */

  private async snapshot(): Promise<Snapshot> {
    if (this.snapCache && Date.now() - this.snapCache.at < SNAPSHOT_TTL_MS) return this.snapCache;
    if (this.snapInFlight) return this.snapInFlight;
    const run = this.build();
    this.snapInFlight = run;
    try {
      const snap = await run;
      this.snapCache = snap;
      return snap;
    } finally {
      this.snapInFlight = null;
    }
  }

  private async build(): Promise<Snapshot> {
    const db = this.db();
    const now = Date.now();
    const windowStart = new Date(now - WINDOW_DAYS * DAY_MS);

    const [
      academies, academyProfiles, users, roundDays, studyRoundDays,
      studies, classSchedules, attendance, homework, exams, examAttempts,
      invoices, batches, packs, threads, invites, parentReports,
      classChallenges, classMail, liveGames, externalGames, bookProgress,
      revisions, myGames, myRepertoire, perfs, sessions,
    ] = await Promise.all([
      db.collection("academies").find({}, { projection: { _id: 1, name: 1, ownerId: 1, plan: 1, createdAt: 1 } }).toArray(),
      db.collection("academyProfiles").find({}, { projection: { _id: 1, displayName: 1, updatedAt: 1 } }).toArray(),
      db.collection("users").find({}, { projection: { bpass: 0, linkedAccounts: 0, currentPath: 0 } }).toArray(),
      this.solvesWindow("rounds", windowStart),
      this.solvesWindow("study_rounds", windowStart),
      db.collection("studies").find({}, { projection: { _id: 1, academyId: 1, ownerId: 1, title: 1, visibility: 1, chapterCount: 1, createdAt: 1, updatedAt: 1 } }).toArray(),
      db.collection("classSchedules").find({}, { projection: { _id: 1, academyId: 1, title: 1, coach: 1, createdByUserId: 1, startAt: 1, createdAt: 1, seriesId: 1, batchId: 1, durationMin: 1 } }).toArray(),
      db.collection("classAttendance").find({}, { projection: { _id: 1, key: 1, userId: 1, classId: 1, joinedAt: 1, manual: 1, markedByUserId: 1, name: 1 } }).toArray(),
      db.collection("homework").find({}, { projection: { _id: 1, academyId: 1, coachId: 1, studentId: 1, title: 1, status: 1, assignedAt: 1, dueAt: 1, completedAt: 1 } }).toArray(),
      db.collection("exams").find({}, { projection: { _id: 1, academyId: 1, ownerId: 1, title: 1, createdAt: 1 } }).toArray(),
      db.collection("examAttempts").find({}, { projection: { _id: 1, examId: 1, userId: 1, startedAt: 1, submittedAt: 1 } }).toArray(),
      // snake_case. The camelCase `feeInvoices` exists and is EMPTY — see header.
      db.collection("fees_invoices").find({}, { projection: { _id: 1, academyId: 1, invoiceNo: 1, studentUserId: 1, totalPaise: 1, status: 1, createdAt: 1, dueOn: 1 } }).toArray(),
      db.collection("academyBatches").find({}, { projection: { _id: 1, academyId: 1, createdBy: 1, coachUserId: 1, name: 1, studentIds: 1, createdAt: 1 } }).toArray(),
      db.collection("classPositionPacks").find({}, { projection: { _id: 1, academyId: 1, coachId: 1, coachName: 1, title: 1, classTitle: 1, sentAt: 1, recipientUserIds: 1 } }).toArray(),
      db.collection("messageThreads").find({}, { projection: { _id: 1, academyId: 1, createdAt: 1, lastMessageAt: 1, lastMessageFromUserId: 1 } }).toArray(),
      db.collection("academyInvites").find({}, { projection: { _id: 1, academyId: 1, invitedBy: 1, createdAt: 1 } }).toArray(),
      db.collection("parentReports").find({}, { projection: { _id: 1, academyId: 1, ownerId: 1, generatedAt: 1 } }).toArray(),
      db.collection("classChallenges").find({}, { projection: { _id: 1, classId: 1, startedAt: 1 } }).toArray(),
      db.collection("classMailLog").find({}, { projection: { _id: 1, coachId: 1, at: 1 } }).toArray(),
      db.collection("live_games").find({}, { projection: { _id: 1, players: 1, startedAt: 1, finishedAt: 1 } }).toArray(),
      db.collection("externalGames").aggregate([{ $group: { _id: "$userId", n: { $sum: 1 }, last: { $max: "$importedAt" } } }]).toArray(),
      db.collection("bookProgress").aggregate([{ $group: { _id: "$userId", n: { $sum: 1 }, last: { $max: "$updatedAt" } } }]).toArray(),
      db.collection("revisions").aggregate([{ $group: { _id: "$userId", n: { $sum: 1 }, last: { $max: "$createdAt" } } }]).toArray(),
      // ownerId, NOT userId — querying userId returns 0 for everyone.
      db.collection("myGames").find({}, { projection: { _id: 1, academyId: 1, ownerId: 1, createdAt: 1 } }).toArray(),
      db.collection("myRepertoire").find({}, { projection: { _id: 1, academyId: 1, ownerId: 1, createdAt: 1 } }).toArray(),
      db.collection("userperfs").find({}, { projection: { _id: 1, puzzle: 1 } }).toArray(),
      db.collection("sessions").find({}, { projection: { _id: 1, expires: 1, session: 1 } }).toArray(),
    ]);

    /* -- buckets ----------------------------------------------------------- */
    const buckets = new Map<string, Bucket>();
    for (const a of academies) buckets.set(String(a._id), this.newBucket(String(a._id), a));
    buckets.set(STANDALONE_ID, this.newBucket(STANDALONE_ID, null));

    /* -- membership windows ------------------------------------------------ */
    // No collection records which academy a user belonged to at the time of an
    // event — membership lives only as the user's CURRENT academyId, so history
    // retroactively follows a transfer. `academyDetachedFrom` + `academyDetachedAt`
    // give back exactly one previous membership, which is enough: all 7 detached
    // accounts on the platform sit in chess-guru today (4 ex-Guna, 3 ex-Shriguru),
    // and without this their entire earlier history reads as chess-guru's.
    // A window starts at max(academy.createdAt, the day they arrived) and ends
    // when they left. Anything outside every window belongs to nobody.
    const userById = new Map<string, any>();
    const windows = new Map<string, MemberWindow[]>();
    const orphanAcademyOf = new Map<string, string>();
    const dayOf = (t: number) => (t > 0 && Number.isFinite(t) ? this.istDay(t) : null);
    // Every boundary is snapped to 00:00 IST of the day it falls on. `rounds`
    // can only be bucketed by day (that is the granularity the per-day scan
    // returns), so a mid-day boundary would make the lifetime total and the
    // 30-day window disagree about the same academy — the exact "same label,
    // two meanings" bug this page is being consolidated to kill. ONE rule:
    // a signup or a transfer takes effect at the start of its IST day.
    const dayStart = (t: number) => {
      if (!t || !Number.isFinite(t) || t <= 0) return 0;
      return Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
    };

    for (const u of users) {
      const uid = String(u._id);
      userById.set(uid, u);

      const claimed = u.academyId ? String(u.academyId) : null;
      let curId = STANDALONE_ID;
      if (claimed) {
        if (buckets.has(claimed)) curId = claimed;
        // A dangling academyId — the academy row is gone. The account is real
        // and still signs in, so it is parked in the standalone bucket and
        // FLAGGED, never dropped (which is how 121 users silently became 118).
        else orphanAcademyOf.set(uid, claimed);
      }
      const cur = buckets.get(curId)!;

      const detachedFrom = u.academyDetachedFrom ? String(u.academyDetachedFrom) : null;
      const detachedAt = dayStart(this.ts(u.academyDetachedAt));
      const list: MemberWindow[] = [];
      if (detachedFrom && detachedAt && buckets.has(detachedFrom) && detachedFrom !== curId) {
        const prev = buckets.get(detachedFrom)!;
        const from = dayStart(this.ts(prev.academy?.createdAt));
        list.push({ bucketId: detachedFrom, from, to: detachedAt, fromDay: dayOf(from), toDay: dayOf(detachedAt) });
        prev.pastMembers.push(u);
      }
      const start = Math.max(dayStart(this.ts(cur.academy?.createdAt)), detachedAt);
      list.push({ bucketId: curId, from: start, to: Infinity, fromDay: dayOf(start), toDay: null });
      windows.set(uid, list);

      cur.members.push(u);
      cur.memberIds.add(uid);
      if (u.role === "coach" || u.role === "academy_owner") cur.staffIds.add(uid);
    }
    // The academy owner is staff even if their user row is missing or odd.
    for (const a of academies) {
      const b = buckets.get(String(a._id));
      if (b && a.ownerId) b.staffIds.add(String(a.ownerId));
    }

    /** Which bucket a user-keyed artefact belongs to, by the moment it happened. */
    const bucketAt = (uid: any, at: number): Bucket | undefined => {
      if (!uid) return undefined;
      const list = windows.get(String(uid));
      if (!list) return undefined;
      if (!at) {
        // No usable timestamp. Only the current membership can be asserted, and
        // only when it has no start clamp to violate.
        const last = list[list.length - 1]!;
        return last.from > 0 ? undefined : buckets.get(last.bucketId);
      }
      for (const w of list) if (at >= w.from && at < w.to) return buckets.get(w.bucketId);
      return undefined;
    };
    /** Same question for a whole IST day. The transfer day itself goes to the
     *  NEW academy (the window is half-open). */
    const bucketOnDay = (uid: string, day: string): Bucket | undefined => {
      const list = windows.get(uid);
      if (!list) return undefined;
      for (const w of list) {
        if (w.fromDay && day < w.fromDay) continue;
        if (w.toDay && day >= w.toDay) continue;
        return buckets.get(w.bucketId);
      }
      return undefined;
    };

    /* -- per-user solve day maps (bounded window) -------------------------- */
    const puzzleDays = new Map<string, Map<string, number>>();
    const studyDays = new Map<string, Map<string, number>>();
    const fold = (rows: any[], days: Map<string, Map<string, number>>) => {
      for (const r of rows) {
        const uid = String(r._id?.uid ?? "");
        const day = r._id?.day;
        if (!uid || !day) continue;
        const m = days.get(uid) ?? new Map<string, number>();
        m.set(day, (m.get(day) ?? 0) + (Number(r.n) || 0));
        days.set(uid, m);
      }
    };
    fold(roundDays, puzzleDays);
    fold(studyRoundDays, studyDays);

    // Credit each day's solves to whichever bucket the solver belonged to THAT
    // day, so a transferred account's old history stays with the old academy.
    const creditDays = (
      src: Map<string, Map<string, number>>,
      pick: (b: Bucket) => Map<string, number>,
    ) => {
      for (const [uid, m] of src) {
        for (const [day, n] of m) {
          const b = bucketOnDay(uid, day);
          if (!b) continue;
          const target = pick(b);
          target.set(day, (target.get(day) ?? 0) + n);
          const set = b.dayActive.get(day) ?? new Set<string>();
          set.add(uid);
          b.dayActive.set(day, set);
        }
      }
    };
    creditDays(puzzleDays, (b) => b.dayPuzzles);
    creditDays(studyDays, (b) => b.dayStudy);

    /* -- lifetime solve totals (cached, membership-clamped) ---------------- */
    const cutSet = new Set<number>();
    for (const list of windows.values()) {
      for (const w of list) {
        if (w.from > 0 && Number.isFinite(w.from)) cutSet.add(w.from);
        if (Number.isFinite(w.to)) cutSet.add(w.to);
      }
    }
    const cuts = [...cutSet].sort((a, b) => a - b);
    const life = await this.lifetimeSolves(cuts);

    const puzzleTotal = new Map<string, number>();
    const studyTotal = new Map<string, number>();
    const puzzleLast = new Map<string, number>();
    const studyLast = new Map<string, number>();
    for (const [uid, rec] of life.puzzles) { puzzleTotal.set(uid, rec.n); puzzleLast.set(uid, rec.last); }
    for (const [uid, rec] of life.studies) { studyTotal.set(uid, rec.n); studyLast.set(uid, rec.last); }

    for (const [uid, list] of windows) {
      const p = life.puzzles.get(uid);
      const s = life.studies.get(uid);
      let pMine = 0;
      for (const w of list) {
        const b = buckets.get(w.bucketId);
        if (!b) continue;
        const pn = this.inWindow(p, life.cuts, w);
        const sn = this.inWindow(s, life.cuts, w);
        // "Last used" must land inside the window it is being credited to: a
        // departed account's solves from last night are not evidence that the
        // academy it LEFT is still alive.
        const clamp = (t: number) => (Number.isFinite(w.to) && t >= w.to ? w.to - 1 : t);
        if (pn > 0) this.mark(b, "puzzles", clamp(puzzleLast.get(uid) ?? 0), pn);
        if (sn > 0) this.mark(b, "studySolves", clamp(studyLast.get(uid) ?? 0), sn);
        if (b.memberIds.has(uid)) pMine += pn;
      }
      // Everything this CURRENT member solved before they were a member here:
      // a personal account predating the academy, or history from the academy
      // they transferred out of. Reported, never silently folded in.
      const curBucket = buckets.get(list[list.length - 1]!.bucketId);
      if (curBucket && p) this.bump(curBucket, "puzzles", "beforeJoining", Math.max(0, p.n - pMine));
    }

    /* -- studies ----------------------------------------------------------- */
    const studiesByOwner = new Map<string, number>();
    for (const s of studies) {
      const owner = s.ownerId ? String(s.ownerId) : null;
      if (owner) studiesByOwner.set(owner, (studiesByOwner.get(owner) ?? 0) + 1);
      const at = this.ts(s.createdAt);
      // An explicit academyId is the academy's own word. Otherwise it belongs to
      // whichever academy the author was in AT THE TIME — the same clamp puzzle
      // solves get. Without it, ranjith_vsk's two personal studies from
      // 2026-08-17 read as chess-guru content and chess-guru was created on
      // 2026-08-18: a study count of 3 where the true answer is 1.
      const b = s.academyId ? buckets.get(String(s.academyId)) : bucketAt(owner, at);
      if (!b) continue;
      this.mark(b, "studies", at);
      this.bump(b, "studies", "chapters", Number(s.chapterCount) || 0);
      // Studies are created by students too — only staff-authored ones count as
      // coach-side effort.
      this.bump(b, "studies", owner && b.staffIds.has(owner) ? "byStaff" : "byStudents", 1);
      this.ev(b, at, "study", owner);
      b.recent.studies.push(s);
    }

    /* -- classes ----------------------------------------------------------- */
    const classToAcademy = new Map<string, string>();
    const heldClassIds = new Set<string>();
    const seriesByAcademy = new Map<string, Set<string>>();
    for (const c of classSchedules) {
      const aid = c.academyId ? String(c.academyId) : "";
      const b = buckets.get(aid);
      classToAcademy.set(String(c._id), aid);
      if (!b) continue;
      const at = this.ts(c.startAt) || this.ts(c.createdAt);
      this.mark(b, "classes", at);
      // seriesId/seriesTotal mean one coach action can create many rows — raw
      // row count overstates effort, so distinct series is the action count.
      const set = seriesByAcademy.get(aid) ?? new Set<string>();
      set.add(String(c.seriesId || c._id));
      seriesByAcademy.set(aid, set);
      this.ev(b, this.ts(c.createdAt) || at, "class", c.createdByUserId ? String(c.createdByUserId) : null, true);
      b.recent.classes.push(c);
    }

    /* -- attendance -------------------------------------------------------- */
    // No academyId. `key` and `userId` give identical per-academy counts; `key`
    // is the safer join. classId is NOT reliable (132 distinct, only 54 join).
    for (const r of attendance) {
      const uid = r.userId ? String(r.userId) : r.key ? String(r.key) : null;
      const at = this.ts(r.joinedAt);
      const b = bucketAt(uid, at);
      if (!b) continue;
      this.mark(b, "attendance", at);
      if (r.manual === true || r.markedByUserId) {
        // Only these prove a human marked a register; the rest is auto-presence
        // from live rooms.
        this.mark(b, "manualAttendance", at);
        this.bump(b, "attendance", "manualMarks", 1);
        this.ev(b, at, "attendance:manual", r.markedByUserId ? String(r.markedByUserId) : null, true);
      } else {
        this.bump(b, "attendance", "autoPresence", 1);
        this.ev(b, at, "attendance", uid);
      }
      if (r.classId && classToAcademy.has(String(r.classId))) heldClassIds.add(String(r.classId));
    }
    for (const [aid, set] of seriesByAcademy) this.bump(buckets.get(aid), "classes", "series", set.size);
    for (const c of classSchedules) {
      // Scheduled != held. Only schedules with an attendance row actually ran.
      if (!heldClassIds.has(String(c._id))) continue;
      const cb = buckets.get(String(c.academyId ?? ""));
      if (!cb) continue;
      cb.heldClasses.add(String(c._id));
      this.bump(cb, "classes", "held", 1);
    }
    // features.classes.count is the schedule-row count; surface it in `detail`
    // alongside held/series so the three are readable together.
    for (const b of buckets.values()) {
      const nSched = b.featureCounts["classes"] ?? 0;
      if (nSched > 0) this.bump(b, "classes", "scheduled", nSched);
    }

    /* -- homework ---------------------------------------------------------- */
    for (const h of homework) {
      const at = this.ts(h.assignedAt);
      const b = h.academyId ? buckets.get(String(h.academyId)) : bucketAt(h.studentId, at);
      if (!b) continue;
      this.mark(b, "homework", at);
      const st = String(h.status || "assigned");
      this.bump(b, "homework", st === "completed" ? "completed" : st === "in_progress" ? "inProgress" : "assigned", 1);
      this.ev(b, at, "homework", h.coachId ? String(h.coachId) : null, true);
      b.recent.homework.push(h);
    }

    /* -- exams ------------------------------------------------------------- */
    // The whole platform has ONE exam. Its attempts are reported with who made
    // them, because 4 attempts by the person who wrote the exam is a smoke test,
    // not adoption, and the chip alone cannot tell you which it was.
    const examToAcademy = new Map<string, string>();
    const examTakers = new Map<string, Set<string>>();
    for (const e of exams) {
      const aid = e.academyId ? String(e.academyId) : "";
      examToAcademy.set(String(e._id), aid);
      const b = buckets.get(aid);
      if (!b) continue;
      const at = this.ts(e.createdAt);
      this.mark(b, "exams", at);
      this.bump(b, "exams", "exams", 1);
      this.ev(b, at, "exam", e.ownerId ? String(e.ownerId) : null, true);
      b.recent.exams.push(e);
    }
    for (const a of examAttempts) {
      const aid = examToAcademy.get(String(a.examId)) ?? "";
      const b = buckets.get(aid) ?? bucketAt(a.userId, this.ts(a.startedAt));
      if (!b) continue;
      this.bump(b, "exams", "attempts", 1);
      const uid = a.userId ? String(a.userId) : "";
      if (uid) {
        const set = examTakers.get(b.id) ?? new Set<string>();
        set.add(uid);
        examTakers.set(b.id, set);
        if (b.staffIds.has(uid)) this.bump(b, "exams", "attemptsByStaff", 1);
      }
    }
    for (const [bid, set] of examTakers) this.bump(buckets.get(bid), "exams", "distinctTakers", set.size);

    /* -- fees -------------------------------------------------------------- */
    for (const inv of invoices) {
      const b = inv.academyId ? buckets.get(String(inv.academyId)) : undefined;
      if (!b) continue;
      const at = this.ts(inv.createdAt);
      this.mark(b, "fees", at);
      this.bump(b, "fees", "invoices", 1);
      this.bump(b, "fees", "billedPaise", Number(inv.totalPaise) || 0);
      // Only staff can raise an invoice; the collection carries no author field,
      // so this is attributed to the academy rather than to a person.
      this.ev(b, at, "invoice", null, true);
      b.recent.invoices.push(inv);
    }

    /* -- play -------------------------------------------------------------- */
    for (const g of liveGames) {
      const at = this.ts(g.finishedAt) || this.ts(g.startedAt);
      const seen = new Set<string>();
      for (const side of ["white", "black"]) {
        const raw = String(g.players?.[side] ?? "");
        if (!raw.startsWith("u:")) continue; // anon:/guest_/e2e_probe are not tenants
        const uid = raw.slice(2);
        const b = bucketAt(uid, at);
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        this.mark(b, "play", at);
        this.bump(b, "play", "games", 1);
        this.ev(b, at, "game", uid);
      }
    }

    /* -- operational long tail --------------------------------------------- */
    for (const bt of batches) {
      const b = buckets.get(String(bt.academyId ?? ""));
      if (!b) continue;
      const at = this.ts(bt.createdAt);
      this.mark(b, "batches", at);
      this.ev(b, at, "batch", String(bt.createdBy || bt.coachUserId || ""), true);
      b.recent.batches.push(bt);
    }
    for (const p of packs) {
      const at = this.ts(p.sentAt);
      const b = p.academyId ? buckets.get(String(p.academyId)) : bucketAt(p.coachId, at);
      if (!b) continue;
      this.mark(b, "positionPacks", at);
      this.ev(b, at, "positionPack", p.coachId ? String(p.coachId) : null, true);
      b.recent.positionPacks.push(p);
    }
    for (const t of threads) {
      const b = buckets.get(String(t.academyId ?? ""));
      if (!b) continue;
      const at = this.ts(t.lastMessageAt) || this.ts(t.createdAt);
      this.mark(b, "messaging", at);
      this.ev(b, at, "message", t.lastMessageFromUserId ? String(t.lastMessageFromUserId) : null);
    }
    for (const i of invites) {
      const b = buckets.get(String(i.academyId ?? ""));
      if (!b) continue;
      const at = this.ts(i.createdAt);
      this.mark(b, "invites", at);
      this.ev(b, at, "invite", i.invitedBy ? String(i.invitedBy) : null, true);
    }
    for (const r of parentReports) {
      const b = buckets.get(String(r.academyId ?? ""));
      if (!b) continue;
      const at = this.ts(r.generatedAt);
      this.mark(b, "parentReports", at);
      this.ev(b, at, "parentReport", r.ownerId ? String(r.ownerId) : null, true);
    }
    for (const c of classChallenges) {
      const b = buckets.get(classToAcademy.get(String(c.classId)) ?? "");
      if (!b) continue;
      this.mark(b, "classChallenges", this.ts(c.startedAt));
    }
    for (const m of classMail) {
      const at = this.ts(m.at);
      const b = bucketAt(m.coachId, at);
      if (!b) continue;
      this.mark(b, "classMail", at);
      this.ev(b, at, "classMail", m.coachId ? String(m.coachId) : null, true);
    }
    for (const p of academyProfiles) {
      const b = buckets.get(String(p._id)); // _id IS the academyId; there is no academyId field
      if (!b) continue;
      this.mark(b, "publicProfile", this.ts(p.updatedAt));
    }

    /* -- individual long tail ---------------------------------------------- */
    const foldByUser = (rows: any[], key: string) => {
      for (const r of rows) {
        const b = bucketAt(r._id, this.ts(r.last));
        if (!b) continue;
        this.mark(b, key, this.ts(r.last), Number(r.n) || 0);
      }
    };
    foldByUser(externalGames, "externalGames");
    foldByUser(bookProgress, "books");
    foldByUser(revisions, "revisions");
    for (const g of myGames) {
      this.mark(g.academyId ? buckets.get(String(g.academyId)) : bucketAt(g.ownerId, this.ts(g.createdAt)), "myGames", this.ts(g.createdAt));
    }
    for (const r of myRepertoire) {
      this.mark(r.academyId ? buckets.get(String(r.academyId)) : bucketAt(r.ownerId, this.ts(r.createdAt)), "repertoire", this.ts(r.createdAt));
    }

    /* -- new member accounts are an academy event -------------------------- */
    for (const b of buckets.values()) {
      for (const u of b.members) this.ev(b, this.ts(u.createdAt), "member", null, false);
    }

    /* -- side tables the drill-down needs ---------------------------------- */
    const ratingByUser = new Map<string, number>();
    for (const p of perfs) {
      const r = p?.puzzle?.gl?.r;
      if (typeof r === "number" && Number.isFinite(r)) ratingByUser.set(String(p._id), Math.round(r));
    }
    // express-session with rolling:true rewrites `expires` on every request, so
    // expires - maxAge is the last request that account made. Hard 30-day
    // horizon: no row means "nothing in 30 days", NEVER "never signed in".
    const lastRequest = new Map<string, number>();
    for (const s of sessions) {
      const exp = this.ts(s.expires);
      if (!exp) continue;
      let uid = "", maxAge = 30 * DAY_MS;
      try {
        const j = JSON.parse(String(s.session ?? "{}"));
        uid = j?.userId ? String(j.userId) : "";
        if (typeof j?.cookie?.originalMaxAge === "number" && j.cookie.originalMaxAge > 0) maxAge = j.cookie.originalMaxAge;
      } catch { continue; }
      if (!uid) continue;
      const at = exp - maxAge;
      if (at > (lastRequest.get(uid) ?? 0)) lastRequest.set(uid, at);
    }

    /* -- rows -------------------------------------------------------------- */
    const profileName = new Map<string, string>();
    for (const p of academyProfiles) if (p.displayName) profileName.set(String(p._id), String(p.displayName));
    const days = this.recentDays(now, SERIES_DAYS);
    const ctx = { profileName, userById, lastRequest, orphanAcademyOf, days };

    const rows: AcademyAdoptionRow[] = [];
    for (const a of academies) {
      const b = buckets.get(String(a._id))!;
      // One academy with a corrupt row must degrade to one broken card, not a
      // 500 that takes the whole page with it.
      try {
        rows.push(this.buildRow(b, now, ctx));
      } catch (err: any) {
        const row = this.buildEmptyRow(b.id, String(a.name ?? b.id), "academy");
        row.synthetic = false;
        row.dataError = String(err?.message ?? err ?? "row could not be computed");
        row.health = { band: "dormant", label: "Unreadable", reason: `This academy's row could not be computed: ${row.dataError}`, severity: SEVERITY.dormant, tier: 0 };
        rows.push(row);
      }
    }
    // Attention first, and never alphabetical: real customers before the
    // vendor's own sandbox and test shells, then most-urgent health, then the
    // longest staff silence, then size.
    // ARRAY ORDER IS THE LEGACY PICKER'S ORDER: the two sentinels, then academies
    // by student count descending, exactly as AdminService.listAcademies() has
    // returned it since 2026-08-27. The adoption page does its own
    // attention-first sort client-side on health.tier / health.severity — which
    // is why both are on every row.
    rows.sort((x, y) => y.studentCount - x.studentCount || x.name.localeCompare(y.name));

    const standalone = this.buildRow(buckets.get(STANDALONE_ID)!, now, ctx);
    // LEGACY SEMANTICS, and user-visible: Leaderboard.tsx renders
    // "{name} ({studentCount})" in the dropdown. For the standalone sentinel
    // that number has always been "accounts with no academyId at all" (role
    // ignored), and the grand total has always been every academy's students
    // plus those accounts. Orphans — an academyId pointing at a deleted academy
    // — are parked in this bucket but are NOT part of that legacy count.
    standalone.studentCount = standalone.people.total - standalone.people.orphaned;
    rows.unshift(standalone);
    const all = this.buildAllRow(rows, now, days);
    all.studentCount = rows.reduce((n, r) => n + r.studentCount, 0);
    rows.unshift(all);

    return {
      at: Date.now(), now, rows, buckets,
      puzzleDays, studyDays, puzzleLast, studyLast, puzzleTotal, studyTotal,
      userById, studiesByOwner, windows, ratingByUser, lastRequest, orphanAcademyOf, days,
    };
  }

  /* ----------------------------------------------------------------- row -- */

  private buildRow(
    b: Bucket, now: number,
    ctx: {
      profileName: Map<string, string>; userById: Map<string, any>;
      lastRequest: Map<string, number>; orphanAcademyOf: Map<string, string>; days: string[];
    },
  ): AcademyAdoptionRow {
    const a = b.academy;
    const isStandalone = b.id === STANDALONE_ID;
    const createdAt = a ? this.ts(a.createdAt) : 0;
    const createdRaw = a?.createdAt;
    const dataError = a && createdRaw != null && createdAt === 0
      ? `academies.createdAt is unreadable (${String(createdRaw).slice(0, 40)}) — age and the signup clamp are unavailable`
      : null;
    const ageDays = createdAt ? Math.max(0, Math.floor((now - createdAt) / DAY_MS)) : null;

    /* people */
    const roles = { students: 0, coaches: 0, parents: 0, owners: 0, other: 0 };
    let everLoggedIn = 0, joinedFromElsewhere = 0, orphaned = 0;
    for (const u of b.members) {
      const uid = String(u._id);
      const r = String(u.role || "");
      if (r === "student") roles.students++;
      else if (r === "coach") roles.coaches++;
      else if (r === "parent") roles.parents++;               // broken out, never "other"
      else if (r === "academy_owner") roles.owners++;
      else roles.other++;
      if (u.lastLogin || u.lastSeen || ctx.lastRequest.has(uid)) everLoggedIn++;
      if (u.academyDetachedFrom) joinedFromElsewhere++;
      if (ctx.orphanAcademyOf.has(uid)) orphaned++;
    }
    const total = b.members.length;

    /* activity — ONE window definition, IST calendar days, everywhere */
    const week = this.recentDays(now, WEEK_DAYS);
    const prevWeek = this.recentDays(now, WEEK_DAYS * 2).slice(0, WEEK_DAYS);
    const d7 = new Set(week), dPrev7 = new Set(prevWeek), d30 = new Set(ctx.days);

    let puzzles7d = 0, puzzlesPrev7d = 0, puzzles30d = 0;
    let studySolves7d = 0, studySolvesPrev7d = 0, studySolves30d = 0;
    for (const [day, n] of b.dayPuzzles) {
      if (d7.has(day)) puzzles7d += n;
      else if (dPrev7.has(day)) puzzlesPrev7d += n;
      if (d30.has(day)) puzzles30d += n;
    }
    for (const [day, n] of b.dayStudy) {
      if (d7.has(day)) studySolves7d += n;
      else if (dPrev7.has(day)) studySolvesPrev7d += n;
      if (d30.has(day)) studySolves30d += n;
    }
    const active7 = new Set<string>(), activePrev7 = new Set<string>(), active30 = new Set<string>();
    let activeDays30 = 0;
    for (const [day, set] of b.dayActive) {
      if (d7.has(day)) for (const u of set) active7.add(u);
      else if (dPrev7.has(day)) for (const u of set) activePrev7.add(u);
      if (d30.has(day)) { for (const u of set) active30.add(u); if (set.size) activeDays30++; }
    }

    let ev7 = 0, ev30 = 0, lastEvent = 0, lastStaff = 0;
    const staffDays = new Set<string>();
    const activeStaff = new Set<string>();
    for (const e of b.events) {
      if (!e.at) continue;
      const day = this.istDay(e.at);
      if (day && d7.has(day)) ev7++;
      if (day && d30.has(day)) ev30++;
      if (e.at > lastEvent) lastEvent = e.at;
      if (e.kind === "member") continue;
      const actorIsOwnStaff = e.actor != null && b.staffIds.has(e.actor);
      // The platform owner's traffic touches every tenant. An artefact one of US
      // authored inside a customer's academy is vendor activity, not the
      // customer's habit — it must never make a dormant academy look alive.
      if (e.actor != null && !actorIsOwnStaff && isAdmin(e.actor)) { b.vendorActions++; continue; }
      if (!(e.staffOnly || actorIsOwnStaff)) continue;
      if (actorIsOwnStaff) activeStaff.add(e.actor!);
      if (e.at > lastStaff) lastStaff = e.at;
      if (day) staffDays.add(day);
    }

    const lastPuzzle = Math.max(b.featureLast["puzzles"] ?? 0, b.featureLast["studySolves"] ?? 0);
    const lastActivity = Math.max(lastEvent, lastPuzzle);

    // Age-normalised staff habit window. A raw 14-day window scores a week-old
    // tenant 4/14 = 29% purely for not having existed yet.
    const staffWindow = ageDays == null ? 14 : Math.max(1, Math.min(14, ageDays + 1));
    const windowDays = new Set(this.recentDays(now, staffWindow));
    let staffActionDays = 0;
    for (const d of staffDays) if (windowDays.has(d)) staffActionDays++;

    /* feature checklists */
    const detailGroup: Record<string, string> = {
      puzzles: "puzzles", studies: "studies", classes: "classes", homework: "homework",
      exams: "exams", attendance: "attendance", play: "play", fees: "fees",
    };
    const mk = (k: string) => this.feature(b, k, isStandalone, detailGroup[k]);
    const features = FEATURE_KEYS.map(mk);
    const opsFeatures = OPERATIONAL_KEYS.map(mk);
    const indFeatures = INDIVIDUAL_KEYS.map(mk);
    const used = (list: FeatureUse[]) => list.filter((f) => f.used).length;
    const applicable = (list: FeatureUse[]) => list.filter((f) => f.applicable).length;

    /* flags */
    const nameRaw = String(a?.name ?? b.id);
    const displayName = isStandalone
      ? "ChessGuru (no academy)"
      : String(ctx.profileName.get(b.id) || a?.name || b.id);
    const everythingEver = b.events.length + (b.featureCounts["puzzles"] ?? 0) + (b.featureCounts["studySolves"] ?? 0);
    const testByName = !isStandalone && (/\btest\b/i.test(nameRaw) || /(^|-)test(-|$)/i.test(b.id));
    const testByEmptiness = !isStandalone && total === 0 && everythingEver === 0;
    const isTest = testByName || testByEmptiness;
    const owner = a?.ownerId ? String(a.ownerId) : null;
    const ownerUser = owner ? ctx.userById.get(owner) : null;
    const isInternal = !isStandalone && !!owner && isAdmin(owner);

    const activity: AcademyAdoptionRow["activity"] = {
      activeUsers7d: active7.size,
      activeUsersPrev7d: activePrev7.size,
      activeUsers30d: active30.size,
      puzzles7d, puzzlesPrev7d, puzzles30d,
      studySolves7d, studySolvesPrev7d, studySolves30d,
      solves7d: puzzles7d + studySolves7d,
      solvesPrev7d: puzzlesPrev7d + studySolvesPrev7d,
      solves30d: puzzles30d + studySolves30d,
      puzzlesLifetime: b.featureCounts["puzzles"] ?? 0,
      studySolvesLifetime: b.featureCounts["studySolves"] ?? 0,
      puzzlesBeforeJoining: b.detail["puzzles"]?.beforeJoining ?? 0,
      actions7d: puzzles7d + studySolves7d + ev7,
      actions30d: puzzles30d + studySolves30d + ev30,
      activeDays30,
      lastActivityAt: this.iso(lastActivity),
      daysSinceLastActivity: this.daysSince(lastActivity, now),
      lastStaffActionAt: this.iso(lastStaff),
      daysSinceStaffAction: this.daysSince(lastStaff, now),
      staffActionDays,
      staffActionWindowDays: staffWindow,
      activeStaff: activeStaff.size,
      staffTotal: b.staffIds.size,
      vendorActions: b.vendorActions,
    };

    const opsUsed = used(opsFeatures), indUsed = used(indFeatures);
    const health = this.verdict({
      isStandalone, isTest, isInternal, ageDays, activity, opsUsed, indUsed, total, everythingEver,
      opsTotal: applicable(opsFeatures), indTotal: applicable(indFeatures),
    });

    /* sparkline — same 30 IST days, same clamp, as the drill-down chart */
    const cutDay = a ? this.istDay(a.createdAt) : null;
    const spark: SparkPoint[] = ctx.days.map((date) => ({
      date,
      puzzles: b.dayPuzzles.get(date) ?? 0,
      studySolves: b.dayStudy.get(date) ?? 0,
      preSignup: !!(cutDay && date < cutDay),
    }));

    return {
      id: b.id,
      name: displayName,
      studentCount: roles.students,
      kind: isStandalone ? "standalone" : "academy",
      synthetic: isStandalone,
      ownerId: owner,
      ownerName: ownerUser ? String(ownerUser.name || ownerUser.username || owner) : owner,
      plan: a?.plan ? String(a.plan) : null,
      createdAt: this.iso(createdAt),
      ageDays,
      isTest,
      testReason: testByName
        ? "name matches /test/i"
        : testByEmptiness ? "0 members and nothing has ever been created" : null,
      isInternal,
      dataError,
      people: {
        ...roles, total, everLoggedIn,
        neverLoggedIn: Math.max(0, total - everLoggedIn),
        joinedFromElsewhere,
        departed: b.pastMembers.length,
        orphaned,
      },
      activity,
      features,
      featuresUsed: used(features),
      featuresApplicable: applicable(features),
      featuresTotal: FEATURE_KEYS.length,
      operational: { used: opsUsed, applicable: applicable(opsFeatures), total: OPERATIONAL_KEYS.length, features: opsFeatures },
      individual: { used: indUsed, applicable: applicable(indFeatures), total: INDIVIDUAL_KEYS.length, features: indFeatures },
      spark,
      health,
    };
  }

  /* ------------------------------------------------------------- verdict -- */

  /** First match wins. The ladder is ordered so that SILENCE is detected before
   *  SIZE, and ADOPTION before AGE: a three-week-old academy that has already
   *  wired in eight operational features is thriving, and saying "Starting"
   *  because of its birthday would hide that. Age only softens the wording for
   *  a tenant that has NOT yet shown depth. Nothing here looks at student count. */
  private verdict(x: {
    isStandalone: boolean; isTest: boolean; isInternal: boolean; ageDays: number | null;
    activity: AcademyAdoptionRow["activity"]; opsUsed: number; indUsed: number;
    total: number; everythingEver: number; opsTotal: number; indTotal: number;
  }): AcademyAdoptionRow["health"] {
    const a = x.activity;
    const sinceStaff = a.daysSinceStaffAction;
    const staffRate = a.staffActionWindowDays > 0 ? a.staffActionDays / a.staffActionWindowDays : 0;
    const pct = Math.round(staffRate * 100);
    // A pill and its own footnote must never contradict each other: whenever the
    // reason quotes the habit ratio it also quotes the recency, in the same
    // sentence, in the same words the footer uses.
    const ago = sinceStaff == null ? "never" : sinceStaff === 0 ? "today" : sinceStaff === 1 ? "yesterday" : `${sinceStaff}d ago`;
    const tier = x.isStandalone ? 3 : x.isTest ? 2 : x.isInternal ? 1 : 0;
    const band = (b: HealthBand, label: string, reason: string) =>
      ({ band: b, label, reason, severity: SEVERITY[b], tier });

    // The standalone bucket is not a tenant: it has no staff and no operations
    // by definition, so the operational ladder would libel it. Activity only.
    if (x.isStandalone) {
      const who = "Standalone signups (not a tenant)";
      if (a.actions30d === 0) return band("dormant", "Dormant", `${who} — nothing in ${SERIES_DAYS} days.`);
      if (a.activeUsers7d >= 3) return band("growing", "Growing", `${who} — ${a.activeUsers7d} of ${x.total} solved something in the last ${WEEK_DAYS} days.`);
      if (a.activeUsers7d >= 1) return band("starting", "Starting", `${who} — ${a.activeUsers7d} of ${x.total} active in the last ${WEEK_DAYS} days.`);
      return band("quiet", "Quiet", `${who} — nobody active in ${WEEK_DAYS} days, ${a.actions30d} actions in ${SERIES_DAYS}.`);
    }

    /* ---- 1. silence, which outranks everything --------------------------- */
    if (x.everythingEver === 0 || a.lastActivityAt === null) {
      return band("dormant", "Dormant", x.isTest
        ? `Test shell — ${x.total} members, nothing has ever been created.`
        : x.ageDays == null
          ? "Nothing has ever happened here, and its signup date is unreadable."
          : `Signed up ${x.ageDays} days ago and nothing has ever happened here.`);
    }
    if (a.actions30d === 0) {
      return band("dormant", "Dormant", `No activity of any kind for ${a.daysSinceLastActivity} days.`);
    }
    if (sinceStaff == null) {
      return band("quiet", "Quiet", a.solves30d > 0
        ? `Students are still solving (${a.solves30d} solves in ${SERIES_DAYS}d) but no coach or owner has ever created anything.`
        : `Nothing has been solved in ${SERIES_DAYS} days and no coach or owner has ever created anything.`);
    }
    if (sinceStaff >= 14) {
      return band("quiet", "Quiet", `No coach or owner has created anything for ${sinceStaff} days — students are still solving, but nobody is running the academy.`);
    }
    if (a.actions7d === 0) {
      return band("quiet", "Quiet", `Nothing at all in the last ${WEEK_DAYS} days; last activity ${a.daysSinceLastActivity} days ago.`);
    }

    /* ---- 2. adoption, tested BEFORE age ---------------------------------- */
    // Age is not a free pass: a young tenant that has genuinely wired itself in
    // reads as Thriving here, and only the thin ones fall through to "Starting".
    if (x.opsUsed >= 6 && staffRate >= 0.5 && a.activeUsers7d >= 3 && sinceStaff <= 3) {
      return band("thriving", "Thriving", `Operations are wired in — ${x.opsUsed}/${x.opsTotal} operational features, staff acted on ${a.staffActionDays} of the last ${a.staffActionWindowDays} days (${pct}%), most recently ${ago}, ${a.activeUsers7d} people active this week.`);
    }
    if (x.opsUsed >= 3 && sinceStaff <= 7) {
      return band("growing", "Growing", `Building it out — ${x.opsUsed}/${x.opsTotal} operational features, staff active on ${a.staffActionDays} of the last ${a.staffActionWindowDays} days, most recently ${ago}, ${a.activeUsers7d} active this week.`);
    }

    /* ---- 3. age softens the wording for the thin ones -------------------- */
    if (x.ageDays != null && x.ageDays <= 21 && staffRate >= 0.3) {
      return band("starting", "Starting", `Only ${x.ageDays} days old and already setting up — staff active on ${a.staffActionDays} of its ${a.staffActionWindowDays} days, most recently ${ago}, ${x.opsUsed}/${x.opsTotal} operational features used.`);
    }
    if (x.opsUsed <= 2 && x.indUsed >= 4) {
      return band("quiet", "Quiet", `Chess gets played here but the academy side is unused — ${x.indUsed}/${x.indTotal} individual features against ${x.opsUsed}/${x.opsTotal} operational ones. Last staff action ${ago}.`);
    }
    return band("quiet", "Quiet", `Thin usage — ${x.opsUsed}/${x.opsTotal} operational features, staff active on only ${a.staffActionDays} of the last ${a.staffActionWindowDays} days (most recently ${ago}).`);
  }

  /** Grand-total sentinel. Exists ONLY so the pre-existing leaderboard picker
   *  keeps working — `studentCount` here is every student on the platform, the
   *  same number the legacy endpoint returned. The adoption page filters on
   *  kind === "academy" and computes its own headline totals, which EXCLUDE the
   *  vendor's own academy. */
  private buildAllRow(rows: AcademyAdoptionRow[], now: number, days: string[]): AcademyAdoptionRow {
    const base = this.buildEmptyRow(ALL_ID, "🌐 All ChessGuru users", "all");
    base.spark = days.map((date) => ({ date, puzzles: 0, studySolves: 0, preSignup: false }));
    const featIdx = new Map(base.features.map((f, i) => [f.key, i]));
    const opsIdx = new Map(base.operational.features.map((f, i) => [f.key, i]));
    const indIdx = new Map(base.individual.features.map((f, i) => [f.key, i]));

    for (const r of rows) {
      base.people.students += r.people.students;
      base.people.coaches += r.people.coaches;
      base.people.parents += r.people.parents;
      base.people.owners += r.people.owners;
      base.people.other += r.people.other;
      base.people.total += r.people.total;
      base.people.everLoggedIn += r.people.everLoggedIn;
      base.people.neverLoggedIn += r.people.neverLoggedIn;
      base.people.joinedFromElsewhere += r.people.joinedFromElsewhere;
      base.people.departed += r.people.departed;
      base.people.orphaned += r.people.orphaned;
      for (const k of [
        "activeUsers7d", "activeUsersPrev7d", "activeUsers30d",
        "puzzles7d", "puzzlesPrev7d", "puzzles30d",
        "studySolves7d", "studySolvesPrev7d", "studySolves30d",
        "solves7d", "solvesPrev7d", "solves30d",
        "puzzlesLifetime", "studySolvesLifetime", "puzzlesBeforeJoining",
        "actions7d", "actions30d", "vendorActions",
      ] as const) {
        base.activity[k] += r.activity[k];
      }
      base.activity.activeDays30 = Math.max(base.activity.activeDays30, r.activity.activeDays30);
      if (r.activity.lastActivityAt && r.activity.lastActivityAt > (base.activity.lastActivityAt ?? "")) {
        base.activity.lastActivityAt = r.activity.lastActivityAt;
      }
      r.spark.forEach((p, i) => {
        const t = base.spark[i];
        if (!t) return;
        t.puzzles += p.puzzles;
        t.studySolves += p.studySolves;
      });
      const merge = (src: FeatureUse[], idx: Map<string, number>, dst: FeatureUse[]) => {
        for (const f of src) {
          const i = idx.get(f.key);
          if (i == null) continue;
          const t = dst[i];
          if (!t) continue;
          t.count += f.count;
          t.used ||= f.used;
          if (f.lastUsedAt && f.lastUsedAt > (t.lastUsedAt ?? "")) t.lastUsedAt = f.lastUsedAt;
        }
      };
      merge(r.features, featIdx, base.features);
      merge(r.operational.features, opsIdx, base.operational.features);
      merge(r.individual.features, indIdx, base.individual.features);
    }
    base.operational.used = base.operational.features.filter((f) => f.used).length;
    base.individual.used = base.individual.features.filter((f) => f.used).length;
    base.featuresUsed = base.features.filter((f) => f.used).length;
    base.activity.daysSinceLastActivity = this.daysSince(this.ts(base.activity.lastActivityAt), now);
    base.health = { band: "aggregate", label: "All tenants", reason: "Grand total across every academy plus standalone signups — not a tenant.", severity: SEVERITY.aggregate, tier: 9 };
    return base;
  }

  private buildEmptyRow(id: string, name: string, kind: AcademyAdoptionRow["kind"]): AcademyAdoptionRow {
    const features = FEATURE_KEYS.map((k) => this.blankFeature(k));
    const ops = OPERATIONAL_KEYS.map((k) => this.blankFeature(k));
    const ind = INDIVIDUAL_KEYS.map((k) => this.blankFeature(k));
    return {
      id, name, studentCount: 0, kind, synthetic: true,
      ownerId: null, ownerName: null, plan: null, createdAt: null, ageDays: null,
      isTest: false, testReason: null, isInternal: false, dataError: null,
      people: {
        students: 0, coaches: 0, parents: 0, owners: 0, other: 0, total: 0,
        everLoggedIn: 0, neverLoggedIn: 0, joinedFromElsewhere: 0, departed: 0, orphaned: 0,
      },
      activity: {
        activeUsers7d: 0, activeUsersPrev7d: 0, activeUsers30d: 0,
        puzzles7d: 0, puzzlesPrev7d: 0, puzzles30d: 0,
        studySolves7d: 0, studySolvesPrev7d: 0, studySolves30d: 0,
        solves7d: 0, solvesPrev7d: 0, solves30d: 0,
        puzzlesLifetime: 0, studySolvesLifetime: 0, puzzlesBeforeJoining: 0,
        actions7d: 0, actions30d: 0, activeDays30: 0,
        lastActivityAt: null, daysSinceLastActivity: null,
        lastStaffActionAt: null, daysSinceStaffAction: null,
        staffActionDays: 0, staffActionWindowDays: 14, activeStaff: 0, staffTotal: 0,
        vendorActions: 0,
      },
      features, featuresUsed: 0, featuresApplicable: features.length, featuresTotal: FEATURE_KEYS.length,
      operational: { used: 0, applicable: ops.length, total: OPERATIONAL_KEYS.length, features: ops },
      individual: { used: 0, applicable: ind.length, total: INDIVIDUAL_KEYS.length, features: ind },
      spark: [],
      health: { band: "dormant", label: "Dormant", reason: "", severity: SEVERITY.dormant, tier: 9 },
    };
  }

  /* =================================================================== API == */

  /** GET /api/admin/academies — the roll-up, one row per academy.
   *
   *  BACKWARD COMPATIBILITY: this must stay a BARE ARRAY whose rows carry
   *  { id, name, studentCount }, and must keep the "__all__" and "__platform__"
   *  sentinel rows, because apps/web/src/pages/Leaderboard.tsx:391 reads it as
   *  the super-admin academy picker. Every adoption field is additive. */
  /** The PICKER path — deliberately cheap.
   *
   *  GET /api/admin/academies?slim=1. Leaderboard.tsx renders this as a plain
   *  dropdown and needs three fields. Serving it from rollup() meant a dropdown
   *  triggered the full adoption build: ~27 collections, two unbounded
   *  aggregates and a 36 KB payload for 3 academies, where the endpoint it
   *  replaced answered in a few hundred bytes from two counts.
   *
   *  Two counts, no snapshot, no cache needed. Shape is byte-compatible with
   *  what the picker consumed before this file existed — {id, name,
   *  studentCount} with the __all__ and __platform__ sentinels first — so the
   *  dropdown cannot regress. Names come from academies.name, NOT the
   *  academyProfiles display name, so the label the owner already recognises
   *  stays put; the adoption page is free to show richer branding.
   */
  async pickerList(): Promise<Array<{ id: string; name: string; studentCount: number }>> {
    const users = this.db().collection("users");
    const [academies, perAcademy, standalone] = await Promise.all([
      this.db().collection("academies").find({}, { projection: { _id: 1, name: 1 } as never }).toArray(),
      users.aggregate([
        { $match: { role: "student", academyId: { $type: "string" } } },
        { $group: { _id: "$academyId", n: { $sum: 1 } } },
      ]).toArray(),
      users.countDocuments({ $or: [{ academyId: { $exists: false } }, { academyId: null }, { academyId: "" }] }),
    ]);
    const byId = new Map<string, number>(perAcademy.map((r: any) => [String(r._id), Number(r.n) || 0]));
    const rows = academies.map((a: any) => ({
      id: String(a._id),
      name: String(a.name ?? a._id),
      studentCount: byId.get(String(a._id)) ?? 0,
    }));
    const total = rows.reduce((n, r) => n + r.studentCount, 0) + standalone;
    return [
      { id: ALL_ID, name: "🌐 All ChessGuru users", studentCount: total },
      { id: STANDALONE_ID, name: "ChessGuru (no academy)", studentCount: standalone },
      ...rows,
    ];
  }

  async rollup(opts: { limit?: number; offset?: number } = {}): Promise<AcademyAdoptionRow[]> {
    const snap = await this.snapshot();
    const limit = Math.min(ROLLUP_MAX_LIMIT, Math.max(1, Number(opts.limit) || ROLLUP_DEFAULT_LIMIT));
    const offset = Math.max(0, Number(opts.offset) || 0);
    return snap.rows.slice(offset, offset + limit);
  }

  /** GET /api/admin/academies/:id — the drill-down. */
  async detail(
    id: string,
    opts: { peopleLimit?: number; peopleOffset?: number; recentLimit?: number } = {},
  ) {
    const snap = await this.snapshot();
    const key = String(id);
    const row = snap.rows.find((r) => r.id === key);
    const b = snap.buckets.get(key);
    if (!row || !b || row.kind === "all") throw new NotFoundException("unknown academy");

    const now = snap.now;
    const peopleLimit = Math.min(PEOPLE_MAX_LIMIT, Math.max(1, Number(opts.peopleLimit) || PEOPLE_DEFAULT_LIMIT));
    const peopleOffset = Math.max(0, Number(opts.peopleOffset) || 0);
    const recentLimit = Math.min(RECENT_MAX_LIMIT, Math.max(1, Number(opts.recentLimit) || RECENT_DEFAULT_LIMIT));

    /* -- per-person rows --------------------------------------------------- */
    // Same 7 IST calendar days as the roll-up card. There is no second,
    // rolling-168-hour definition of "this week" anywhere on this page.
    const d7 = new Set(this.recentDays(now, WEEK_DAYS));
    const d30 = new Set(snap.days);
    // Who authored what, so "last activity" covers a coach who creates but
    // never solves a puzzle.
    const authoredLast = new Map<string, number>();
    for (const e of b.events) {
      if (!e.actor || !e.at) continue;
      if (e.at > (authoredLast.get(e.actor) ?? 0)) authoredLast.set(e.actor, e.at);
    }

    const personRow = (u: any, departed: boolean) => {
      const uid = String(u._id);
      let p7 = 0, p30 = 0, s7 = 0, s30 = 0;
      for (const [day, n] of snap.puzzleDays.get(uid) ?? []) {
        if (d7.has(day)) p7 += n;
        if (d30.has(day)) p30 += n;
      }
      for (const [day, n] of snap.studyDays.get(uid) ?? []) {
        if (d7.has(day)) s7 += n;
        if (d30.has(day)) s30 += n;
      }
      // Every clock we actually have, newest wins. `lastLogin` is in here on
      // purpose: it is present on 119 of 121 accounts and leaving it out is how
      // a real, recently-signed-in person renders as "Last active —".
      // `lastSeenAt` is NOT a field on users — do not "fix" lastSeen to that.
      const last = Math.max(
        snap.puzzleLast.get(uid) ?? 0,
        snap.studyLast.get(uid) ?? 0,
        authoredLast.get(uid) ?? 0,
        this.ts(u.lastSeen),
        this.ts(u.lastLogin),
        snap.lastRequest.get(uid) ?? 0,
      );
      const orphanOf = snap.orphanAcademyOf.get(uid) ?? null;
      return {
        userId: uid,
        username: String(u.username || uid),
        name: String(u.name || u.username || uid),
        role: String(u.role || "—"),
        isStaff: b.staffIds.has(uid),
        joinedAt: this.iso(this.ts(u.createdAt)),
        /** true = this account came from another academy; its earlier puzzle and
         *  study history is credited to the academy where it happened. */
        joinedFromElsewhere: !!u.academyDetachedFrom,
        detachedFrom: u.academyDetachedFrom ? String(u.academyDetachedFrom) : null,
        /** true = this account has LEFT. Shown because its activity from while
         *  it was here is still counted in this academy's totals. */
        departed,
        departedAt: departed ? this.iso(this.ts(u.academyDetachedAt)) : null,
        /** Their academyId points at an academy row that no longer exists. */
        orphanedAcademyId: orphanOf,
        puzzles7d: p7,
        puzzles30d: p30,
        puzzlesLifetime: snap.puzzleTotal.get(uid) ?? 0,
        studySolves7d: s7,
        studySolves30d: s30,
        studySolvesLifetime: snap.studyTotal.get(uid) ?? 0,
        solves7d: p7 + s7,
        studiesCreated: snap.studiesByOwner.get(uid) ?? 0,
        puzzleRating: snap.ratingByUser.get(uid) ?? null,
        lastActivityAt: this.iso(last),
        daysSinceLastActivity: this.daysSince(last, now),
        // `lastSeen` is the real 60s presence heartbeat. `lastSeenAt` does not
        // exist on users — do not "fix" this to that name.
        lastSeen: this.iso(this.ts(u.lastSeen)),
        lastLogin: this.iso(this.ts(u.lastLogin)),
        // express-session, rolling:true. 30-day horizon — null means "not in the
        // last 30 days", not "never".
        lastRequestAt: this.iso(snap.lastRequest.get(uid) ?? 0),
        everLoggedIn: !!(u.lastLogin || u.lastSeen || snap.lastRequest.has(uid)),
      };
    };

    const people = [
      ...b.members.map((u: any) => personRow(u, false)),
      ...b.pastMembers.map((u: any) => personRow(u, true)),
    ].sort((x, y) =>
      Number(x.departed) - Number(y.departed) ||
      (this.ts(y.lastActivityAt) - this.ts(x.lastActivityAt)) ||
      y.puzzles30d - x.puzzles30d);

    /* -- 30-day daily series ----------------------------------------------- */
    const days = snap.days;
    const idx = new Map(days.map((d, i) => [d, i]));
    const cutDay = b.academy ? this.istDay(b.academy.createdAt) : null;
    const series = days.map((date) => ({
      date,
      puzzles: b.dayPuzzles.get(date) ?? 0,
      studySolves: b.dayStudy.get(date) ?? 0,
      activeUsers: b.dayActive.get(date)?.size ?? 0,
      staffActions: 0,
      created: 0,
      // Grey on the chart: before this academy existed, so those solves are the
      // students' personal history and are not credited here.
      preSignup: !!(cutDay && date < cutDay),
    }));
    const activePerDay: Array<Set<string>> = days.map((d) => new Set<string>(b.dayActive.get(d) ?? []));
    for (const e of b.events) {
      const day = this.istDay(e.at); if (!day) continue;
      const i = idx.get(day); if (i == null) continue;
      if (e.kind === "member") continue;
      series[i]!.created++;
      const actorIsOwnStaff = e.actor != null && b.staffIds.has(e.actor);
      if (e.actor != null && !actorIsOwnStaff && isAdmin(e.actor)) continue;  // vendor traffic
      if (e.staffOnly || actorIsOwnStaff) series[i]!.staffActions++;
      if (e.actor) activePerDay[i]!.add(e.actor);
    }
    series.forEach((s, i) => { s.activeUsers = activePerDay[i]!.size; });

    /* -- what has actually been created recently --------------------------- */
    // ONE merged, newest-first feed with a REAL total, so "40 of N" means what
    // it says. Sorted on the actual date field of each row — NEVER on _id:
    // classSchedules, academyBatches, exams, classPositionPacks and studies all
    // use random STRING ids, so _id order is alphabetical, not chronological.
    const nameOf = (uid: any) => {
      const u = uid ? snap.userById.get(String(uid)) : null;
      return u ? String(u.name || u.username || uid) : uid ? String(uid) : null;
    };
    const rupees = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");

    type Made = { kind: string; title: string; by: string | null; at: string | null; atMs: number; note: string | null; count: number };
    const made: Made[] = [];
    const push = (kind: string, title: any, by: any, at: any, note: string | null = null) => {
      const ms = this.ts(at);
      made.push({ kind, title: String(title ?? "—"), by: by ? nameOf(by) : null, at: this.iso(ms), atMs: ms, note, count: 1 });
    };
    for (const s of b.recent.studies) {
      push("Study", s.title || "(untitled)", s.ownerId, s.createdAt,
        s.chapterCount ? `${s.chapterCount} chapter${Number(s.chapterCount) === 1 ? "" : "s"}` : null);
    }
    for (const c of b.recent.classes) {
      push("Class", c.title || "(untitled class)", c.createdByUserId ?? c.coach, c.createdAt,
        b.heldClasses.has(String(c._id)) ? "held" : "scheduled, no attendance");
    }
    for (const h of b.recent.homework) {
      push("Homework", h.title || "(untitled)", h.coachId, h.assignedAt,
        h.studentId ? `for ${nameOf(h.studentId)} · ${h.status ?? "assigned"}` : String(h.status ?? "assigned"));
    }
    for (const bt of b.recent.batches) {
      push("Batch", bt.name, bt.createdBy || bt.coachUserId, bt.createdAt, `${(bt.studentIds ?? []).length} students`);
    }
    for (const e of b.recent.exams) push("Exam", e.title, e.ownerId, e.createdAt, null);
    for (const p of b.recent.positionPacks) {
      push("Position pack", p.title || p.classTitle, p.coachId, p.sentAt, `sent to ${(p.recipientUserIds ?? []).length}`);
    }
    for (const iv of b.recent.invoices) {
      // BILLED only. fees_payments is empty platform-wide and every invoice is
      // SENT with paidPaise 0, so "collected" is Rs 0 for everyone.
      push("Invoice", iv.invoiceNo, null, iv.createdAt, `${rupees(Number(iv.totalPaise) || 0)} billed · ${iv.status ?? "—"}`);
    }
    made.sort((x, y) => y.atMs - x.atMs);
    // One coach action can write many rows: "One-click practice" assigns the
    // same homework to a whole batch in the same second, and unmerged it fills
    // the entire feed with forty copies of one click. Identical artefacts made
    // by the same person in the same minute collapse to one line with a count.
    const merged: Made[] = [];
    for (const m of made) {
      const prev = merged[merged.length - 1];
      const sameMinute = prev && Math.abs(prev.atMs - m.atMs) < 60_000;
      if (prev && sameMinute && prev.kind === m.kind && prev.title === m.title && prev.by === m.by) {
        prev.count++;
        prev.note = `${prev.count} recipients`;
        continue;
      }
      merged.push({ ...m });
    }

    return {
      academy: row,
      people: {
        rows: people.slice(peopleOffset, peopleOffset + peopleLimit),
        total: people.length,
        current: b.members.length,
        departed: b.pastMembers.length,
        limit: peopleLimit,
        offset: peopleOffset,
      },
      series,
      /** Newest first, every kind merged. `createdTotal` is the REAL total, not
       *  the sum of truncated fetches. */
      created: merged.slice(0, recentLimit).map(({ atMs, ...m }) => m),
      /** The REAL total of artefacts, not the sum of truncated fetches and not
       *  the collapsed line count. `createdLines` is what the page is showing. */
      createdTotal: made.length,
      createdLines: merged.length,
      createdLimit: recentLimit,
      generatedAt: new Date(snap.at).toISOString(),
      timezone: IST_TZ,
      weekDays: WEEK_DAYS,
    };
  }
}
