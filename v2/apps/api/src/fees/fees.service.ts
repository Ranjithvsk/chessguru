// Fees service — W1 scope: program + head CRUD.
//
// Money invariants (enforced here, verified by tests later):
//   * amountPaise is always an integer ≥ 1 and ≤ MAX_AMOUNT_PAISE.
//   * A program is deleted-forever only via ARCHIVED status. Hard-delete forbidden.
//   * Every write stamps updatedAt; every write is scoped by academyId.
//
// Multi-tenant rule (matches every other ChessGuru module):
//   session.academyId is the authority. A user's role can be academy_owner or a
//   future 'fees_admin' — for W1 we allow academy_owner only.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";
import {
  BulkEnrollInput,
  COL,
  CreateProgramInput,
  EnrollmentResponse,
  EnrollmentStatus,
  FeeEnrollmentDoc,
  FeeHeadDoc,
  FeeHeadKind,
  FeePlanDoc,
  FeeProgramDoc,
  HeadResponse,
  MAX_AMOUNT_PAISE,
  MAX_BULK_ENROLL,
  MAX_DAY_OF_MONTH,
  MAX_DESC_LEN,
  MAX_DISCOUNT_PCT,
  MAX_DUE_OFFSET_DAYS,
  MAX_HEADS_PER_PROGRAM,
  MAX_LATE_GRACE_DAYS,
  MAX_NAME_LEN,
  MIN_AMOUNT_PAISE,
  MIN_DAY_OF_MONTH,
  MIN_DISCOUNT_PCT,
  PlanCadence,
  PlanResponse,
  ProgramResponse,
  StudentPickRow,
  UpsertPlanInput,
  VALID_CADENCES,
  VALID_KINDS,
} from "./fees.types";

interface Session {
  userId?: string;
  role?: string;
  academyId?: string;
}

@Injectable()
export class FeesService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private programs()    { return this.conn.db!.collection<FeeProgramDoc>(COL.programs); }
  private heads()       { return this.conn.db!.collection<FeeHeadDoc>(COL.heads); }
  private plans()       { return this.conn.db!.collection<FeePlanDoc>(COL.plans); }
  private enrollments() { return this.conn.db!.collection<FeeEnrollmentDoc>(COL.enrollments); }
  // ChessGuru already models students + parents as users rows — we reuse.
  private users()       { return this.conn.db!.collection("users"); }

  // Called on module init to make sure the indices we count on for tenant scoping
  // and lookup are present. Idempotent — createIndex is a no-op on second run.
  async ensureIndices() {
    await this.programs().createIndex({ academyId: 1, status: 1, updatedAt: -1 });
    await this.heads().createIndex({ academyId: 1, programId: 1, order: 1 });
    await this.plans().createIndex({ academyId: 1, programId: 1 }, { unique: true });
    await this.enrollments().createIndex({ academyId: 1, planId: 1, studentUserId: 1 }, { unique: true });
    await this.enrollments().createIndex({ academyId: 1, status: 1, updatedAt: -1 });
  }

  // ---- guards ---------------------------------------------------------------

  private requireOwner(session: Session): { userId: string; academyId: string } {
    const userId = session?.userId;
    const academyId = session?.academyId;
    const role = session?.role;
    if (!userId || !academyId) throw new ForbiddenException("Sign in required.");
    // W1: only academy_owner. Add 'fees_admin' role when we ship user-management for it.
    if (role !== "academy_owner") throw new ForbiddenException("Only the academy owner can manage fees for now.");
    return { userId, academyId };
  }

  private assertName(name: unknown): string {
    if (typeof name !== "string") throw new BadRequestException("Name is required.");
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new BadRequestException("Name is required.");
    if (trimmed.length > MAX_NAME_LEN) throw new BadRequestException(`Name is too long (max ${MAX_NAME_LEN} characters).`);
    return trimmed;
  }

  private assertDescription(desc: unknown): string | undefined {
    if (desc === undefined || desc === null || desc === "") return undefined;
    if (typeof desc !== "string") throw new BadRequestException("Description must be text.");
    const trimmed = desc.trim();
    if (trimmed.length > MAX_DESC_LEN) throw new BadRequestException(`Description is too long (max ${MAX_DESC_LEN} characters).`);
    return trimmed || undefined;
  }

  private assertAmount(amountPaise: unknown, label: string): number {
    if (typeof amountPaise !== "number" || !Number.isFinite(amountPaise) || !Number.isInteger(amountPaise)) {
      throw new BadRequestException(`${label} must be a whole number in paise (e.g. ₹1,800 = 180000).`);
    }
    if (amountPaise < MIN_AMOUNT_PAISE) throw new BadRequestException(`${label} must be at least ₹1.`);
    if (amountPaise > MAX_AMOUNT_PAISE) throw new BadRequestException(`${label} exceeds the per-head cap (₹1,00,000).`);
    return amountPaise;
  }

  private assertKind(kind: unknown): FeeHeadKind {
    if (typeof kind !== "string" || !VALID_KINDS.includes(kind as FeeHeadKind)) {
      throw new BadRequestException(`Kind must be one of: ${VALID_KINDS.join(", ")}.`);
    }
    return kind as FeeHeadKind;
  }

  private assertGst(gstPct: unknown): number | undefined {
    if (gstPct === undefined || gstPct === null) return undefined;
    if (typeof gstPct !== "number" || !Number.isFinite(gstPct)) throw new BadRequestException("GST % must be a number.");
    if (gstPct < 0 || gstPct > 28) throw new BadRequestException("GST % must be between 0 and 28.");
    return gstPct;
  }

  // ---- shapers --------------------------------------------------------------

  private shapeHead(h: FeeHeadDoc): HeadResponse {
    return {
      id: String(h._id),
      name: h.name,
      amountPaise: h.amountPaise,
      kind: h.kind,
      gstPct: h.gstPct,
      hsnSac: h.hsnSac,
      order: h.order,
    };
  }

  private shapeProgram(p: FeeProgramDoc, heads?: FeeHeadDoc[]): ProgramResponse {
    const list = heads ?? [];
    const totalPaise = list.reduce((s, h) => s + h.amountPaise, 0);
    return {
      id: String(p._id),
      name: p.name,
      description: p.description,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      headCount: list.length,
      totalPaise,
      heads: heads ? list.map((h) => this.shapeHead(h)) : undefined,
    };
  }

  // ---- program CRUD ---------------------------------------------------------

  async createProgram(session: Session, input: CreateProgramInput): Promise<ProgramResponse> {
    const { userId, academyId } = this.requireOwner(session);
    const name = this.assertName(input?.name);
    const description = this.assertDescription(input?.description);

    // Heads are optional at create time — an owner may want to build the shell first.
    const rawHeads = Array.isArray(input?.heads) ? input.heads : [];
    if (rawHeads.length > MAX_HEADS_PER_PROGRAM) {
      throw new BadRequestException(`A program can have at most ${MAX_HEADS_PER_PROGRAM} heads.`);
    }
    const validatedHeads = rawHeads.map((h, i) => ({
      name: this.assertName(h?.name),
      amountPaise: this.assertAmount(h?.amountPaise, `Head "${h?.name ?? i + 1}" amount`),
      kind: this.assertKind(h?.kind),
      gstPct: this.assertGst(h?.gstPct),
      order: i,
    }));

    const now = new Date();
    const programDoc: Omit<FeeProgramDoc, "_id"> = {
      academyId,
      name,
      description,
      currency: "INR",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };

    const insertRes = await this.programs().insertOne(programDoc as FeeProgramDoc);
    const programId = insertRes.insertedId;

    let headDocs: FeeHeadDoc[] = [];
    if (validatedHeads.length > 0) {
      const rows: Omit<FeeHeadDoc, "_id">[] = validatedHeads.map((h) => ({
        academyId,
        programId: String(programId),
        name: h.name,
        amountPaise: h.amountPaise,
        kind: h.kind,
        gstPct: h.gstPct,
        order: h.order,
        createdAt: now,
        updatedAt: now,
      }));
      const headInsert = await this.heads().insertMany(rows as FeeHeadDoc[]);
      headDocs = rows.map((r, i) => ({ ...(r as FeeHeadDoc), _id: headInsert.insertedIds[i] as ObjectId }));
    }

    const saved: FeeProgramDoc = { ...(programDoc as FeeProgramDoc), _id: programId as ObjectId };
    return this.shapeProgram(saved, headDocs);
  }

  async listPrograms(session: Session, opts: { status?: string; q?: string } = {}): Promise<ProgramResponse[]> {
    const { academyId } = this.requireOwner(session);
    const filter: Record<string, unknown> = { academyId };
    if (opts.status === "ARCHIVED" || opts.status === "ACTIVE") filter.status = opts.status;
    // Simple substring match — Meili wiring lands in W3.
    if (opts.q && typeof opts.q === "string" && opts.q.trim()) {
      filter.name = { $regex: opts.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    const programs = await this.programs().find(filter).sort({ updatedAt: -1 }).limit(200).toArray();
    if (programs.length === 0) return [];

    // Batch-fetch heads so the list card can show head-count + total-per-month
    // without an N+1 round-trip. Grouped by programId, then attached per program.
    const programIds = programs.map((p) => String(p._id));
    const heads = await this.heads().find({ academyId, programId: { $in: programIds } }).toArray();
    const byProgram = new Map<string, FeeHeadDoc[]>();
    for (const h of heads) {
      const arr = byProgram.get(h.programId) ?? [];
      arr.push(h);
      byProgram.set(h.programId, arr);
    }
    // shapeProgram gets a `[]` when a program has no heads — headCount/totalPaise
    // become 0. `heads` in the response is intentionally left undefined for the
    // list surface; the drawer/detail view fetches it.
    return programs.map((p) => {
      const list = byProgram.get(String(p._id)) ?? [];
      const shaped = this.shapeProgram(p, list);
      // strip full heads array from the list response
      return { ...shaped, heads: undefined };
    });
  }

  async getProgram(session: Session, id: string): Promise<ProgramResponse> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(id);
    const program = await this.programs().findOne({ _id, academyId });
    if (!program) throw new NotFoundException("Program not found.");
    const heads = await this.heads().find({ academyId, programId: String(_id) }).sort({ order: 1 }).toArray();
    return this.shapeProgram(program, heads);
  }

  async archiveProgram(session: Session, id: string): Promise<{ ok: true }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(id);
    const res = await this.programs().updateOne(
      { _id, academyId },
      { $set: { status: "ARCHIVED", updatedAt: new Date() } },
    );
    if (res.matchedCount === 0) throw new NotFoundException("Program not found.");
    return { ok: true };
  }

  // ==========================================================================
  // W2 — Plans
  // ==========================================================================

  private assertCadence(cadence: unknown): PlanCadence {
    if (typeof cadence !== "string" || !VALID_CADENCES.includes(cadence as PlanCadence)) {
      throw new BadRequestException(`Cadence must be one of: ${VALID_CADENCES.join(", ")}.`);
    }
    return cadence as PlanCadence;
  }

  private assertDate(v: unknown, label: string): Date {
    if (typeof v !== "string" || !v.trim()) throw new BadRequestException(`${label} is required.`);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} isn't a valid date.`);
    return d;
  }

  private assertOptionalDate(v: unknown, label: string): Date | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    return this.assertDate(v, label);
  }

  private shapePlan(p: FeePlanDoc): PlanResponse {
    return {
      id: String(p._id),
      programId: p.programId,
      cadence: p.cadence,
      dayOfMonth: p.dayOfMonth,
      dueOffsetDays: p.dueOffsetDays,
      startOn: p.startOn.toISOString(),
      endOn: p.endOn?.toISOString(),
      lateFeeGraceDays: p.lateFeeGraceDays,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** Upsert the single plan attached to a program. First call inserts, subsequent
   *  calls update in place (unique index on academyId+programId enforces 1:1). */
  async upsertPlan(session: Session, programId: string, input: UpsertPlanInput): Promise<PlanResponse> {
    const { academyId } = this.requireOwner(session);
    const pid = this.oid(programId);
    // Program must exist and be ours.
    const program = await this.programs().findOne({ _id: pid, academyId });
    if (!program) throw new NotFoundException("Program not found.");

    const cadence = this.assertCadence(input?.cadence);
    const startOn = this.assertDate(input?.startOn, "Start date");
    const endOn = this.assertOptionalDate(input?.endOn, "End date");
    if (endOn && endOn < startOn) throw new BadRequestException("End date can't be before start date.");

    let dayOfMonth: number | undefined;
    if (cadence === "MONTHLY") {
      const d = input?.dayOfMonth;
      if (typeof d !== "number" || !Number.isInteger(d) || d < MIN_DAY_OF_MONTH || d > MAX_DAY_OF_MONTH) {
        throw new BadRequestException(`Day of month must be an integer between ${MIN_DAY_OF_MONTH} and ${MAX_DAY_OF_MONTH}.`);
      }
      dayOfMonth = d;
    }

    const dueOffsetDays = (typeof input?.dueOffsetDays === "number" && Number.isInteger(input.dueOffsetDays) && input.dueOffsetDays >= 0 && input.dueOffsetDays <= MAX_DUE_OFFSET_DAYS)
      ? input.dueOffsetDays
      : 10;
    const lateFeeGraceDays = (typeof input?.lateFeeGraceDays === "number" && Number.isInteger(input.lateFeeGraceDays) && input.lateFeeGraceDays >= 0 && input.lateFeeGraceDays <= MAX_LATE_GRACE_DAYS)
      ? input.lateFeeGraceDays
      : 7;

    const now = new Date();
    const filter = { academyId, programId: String(pid) };
    const upd = {
      $set: {
        cadence,
        dayOfMonth,
        dueOffsetDays,
        startOn,
        endOn,
        lateFeeGraceDays,
        updatedAt: now,
      },
      $setOnInsert: { academyId, programId: String(pid), createdAt: now },
    };
    await this.plans().updateOne(filter, upd, { upsert: true });
    const saved = await this.plans().findOne(filter);
    if (!saved) throw new Error("Plan upsert vanished.");    // should be impossible
    return this.shapePlan(saved);
  }

  async getPlan(session: Session, programId: string): Promise<PlanResponse | null> {
    const { academyId } = this.requireOwner(session);
    const pid = this.oid(programId);
    const doc = await this.plans().findOne({ academyId, programId: String(pid) });
    return doc ? this.shapePlan(doc) : null;
  }

  // ==========================================================================
  // W2 — Enrollments
  // ==========================================================================

  private shapeEnrollment(e: FeeEnrollmentDoc, meta?: { studentName?: string; guardianName?: string; guardianPhone?: string }): EnrollmentResponse {
    return {
      id: String(e._id),
      planId: e.planId,
      programId: e.programId,
      studentUserId: e.studentUserId,
      studentName: meta?.studentName,
      guardianUserId: e.guardianUserId,
      guardianName: meta?.guardianName,
      guardianPhone: meta?.guardianPhone,
      discountPct: e.discountPct,
      discountFlatPaise: e.discountFlatPaise,
      concessionReason: e.concessionReason,
      startsOn: e.startsOn.toISOString(),
      endsOn: e.endsOn?.toISOString(),
      status: e.status,
      createdAt: e.createdAt.toISOString(),
    };
  }

  /** Enrol multiple students in one plan. Skips students that already have an
   *  ACTIVE enrolment in this plan (idempotent — clicking Enrol twice is safe).
   *  Returns { enrolled, skipped } counts + the fresh rows for optimistic UI. */
  async bulkEnroll(session: Session, input: BulkEnrollInput): Promise<{ enrolled: number; skipped: number; enrollments: EnrollmentResponse[] }> {
    const { userId, academyId } = this.requireOwner(session);
    const planId = this.oid(input?.planId);

    // Plan must exist and be ours (also tells us programId for denorm).
    const plan = await this.plans().findOne({ _id: planId, academyId });
    if (!plan) throw new NotFoundException("Plan not found.");

    const rawIds = Array.isArray(input?.studentUserIds) ? input.studentUserIds : [];
    if (rawIds.length === 0) throw new BadRequestException("Pick at least one student.");
    if (rawIds.length > MAX_BULK_ENROLL) throw new BadRequestException(`Enrol at most ${MAX_BULK_ENROLL} students at once.`);

    // Discount validation (mutually preferred but backend accepts either).
    let discountPct: number | undefined;
    let discountFlatPaise: number | undefined;
    if (typeof input?.discountPct === "number") {
      if (input.discountPct < MIN_DISCOUNT_PCT || input.discountPct > MAX_DISCOUNT_PCT) {
        throw new BadRequestException(`Discount % must be between ${MIN_DISCOUNT_PCT} and ${MAX_DISCOUNT_PCT}.`);
      }
      discountPct = input.discountPct;
    }
    if (typeof input?.discountFlatPaise === "number") {
      if (!Number.isInteger(input.discountFlatPaise) || input.discountFlatPaise < 0) {
        throw new BadRequestException("Flat discount must be a whole number in paise.");
      }
      discountFlatPaise = input.discountFlatPaise;
    }
    const concessionReason = typeof input?.concessionReason === "string" && input.concessionReason.trim()
      ? input.concessionReason.trim().slice(0, MAX_DESC_LEN)
      : undefined;

    const startsOn = input?.startsOn ? this.assertDate(input.startsOn, "Start date") : new Date();

    // Load students — filter to this academy + role=student. Ignore garbage IDs silently
    // (bulk actions where one row is stale shouldn't fail the whole batch).
    const studentOids: ObjectId[] = [];
    for (const s of rawIds) {
      try { studentOids.push(new ObjectId(s)); } catch { /* skip */ }
    }
    const students = await this.users().find({ _id: { $in: studentOids }, academyId, role: "student" }).toArray();
    if (students.length === 0) throw new BadRequestException("None of the picked rows are students in this academy.");

    // Existing enrolments for this plan to compute skip set.
    const existing = await this.enrollments().find({ academyId, planId: String(planId), status: "ACTIVE" }).toArray();
    const alreadyEnrolled = new Set(existing.map((e) => e.studentUserId));

    const now = new Date();
    const inserted: FeeEnrollmentDoc[] = [];
    for (const s of students) {
      const sid = String(s._id);
      if (alreadyEnrolled.has(sid)) continue;
      const guardianUserId: string | undefined = Array.isArray(s.parentIds) && s.parentIds.length > 0 ? String(s.parentIds[0]) : undefined;
      const doc: Omit<FeeEnrollmentDoc, "_id"> = {
        academyId,
        planId: String(planId),
        programId: plan.programId,
        studentUserId: sid,
        guardianUserId,
        discountPct,
        discountFlatPaise,
        concessionReason,
        startsOn,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };
      inserted.push(doc as FeeEnrollmentDoc);
    }

    let enrollmentResponses: EnrollmentResponse[] = [];
    if (inserted.length > 0) {
      const r = await this.enrollments().insertMany(inserted as FeeEnrollmentDoc[]);
      // Enrich with student/guardian names for immediate UI update.
      const studentById = new Map(students.map((s) => [String(s._id), s]));
      const guardianIds = inserted.map((e) => e.guardianUserId).filter((v): v is string => !!v);
      const guardianOids: ObjectId[] = [];
      for (const g of guardianIds) { try { guardianOids.push(new ObjectId(g)); } catch { /* skip */ } }
      const guardians = guardianOids.length ? await this.users().find({ _id: { $in: guardianOids } }).toArray() : [];
      const guardianById = new Map(guardians.map((g) => [String(g._id), g]));
      enrollmentResponses = inserted.map((e, i) => {
        const st = studentById.get(e.studentUserId);
        const gu = e.guardianUserId ? guardianById.get(e.guardianUserId) : undefined;
        return this.shapeEnrollment({ ...e, _id: r.insertedIds[i] as ObjectId }, {
          studentName: st?.name ?? st?.username,
          guardianName: gu?.name ?? gu?.username,
          guardianPhone: gu?.mobile,
        });
      });
    }

    return {
      enrolled: enrollmentResponses.length,
      skipped: rawIds.length - enrollmentResponses.length,
      enrollments: enrollmentResponses,
    };
  }

  async listEnrollments(session: Session, opts: { planId?: string; studentUserId?: string; status?: EnrollmentStatus } = {}): Promise<EnrollmentResponse[]> {
    const { academyId } = this.requireOwner(session);
    const filter: Record<string, unknown> = { academyId };
    if (opts.planId) filter.planId = String(this.oid(opts.planId));
    if (opts.studentUserId) filter.studentUserId = opts.studentUserId;
    if (opts.status === "ACTIVE" || opts.status === "PAUSED" || opts.status === "ENDED") filter.status = opts.status;

    const rows = await this.enrollments().find(filter).sort({ createdAt: -1 }).limit(1000).toArray();
    if (rows.length === 0) return [];

    // Batch resolve student + guardian names for the table view.
    const studentOids: ObjectId[] = [];
    const guardianOids: ObjectId[] = [];
    for (const r of rows) {
      try { studentOids.push(new ObjectId(r.studentUserId)); } catch { /* skip */ }
      if (r.guardianUserId) { try { guardianOids.push(new ObjectId(r.guardianUserId)); } catch { /* skip */ } }
    }
    const [students, guardians] = await Promise.all([
      studentOids.length ? this.users().find({ _id: { $in: studentOids } }, { projection: { _id: 1, name: 1, username: 1 } as never }).toArray() : Promise.resolve([]),
      guardianOids.length ? this.users().find({ _id: { $in: guardianOids } }, { projection: { _id: 1, name: 1, username: 1, mobile: 1 } as never }).toArray() : Promise.resolve([]),
    ]);
    const studentById = new Map(students.map((s) => [String(s._id), s]));
    const guardianById = new Map(guardians.map((g) => [String(g._id), g]));

    return rows.map((r) => {
      const st = studentById.get(r.studentUserId);
      const gu = r.guardianUserId ? guardianById.get(r.guardianUserId) : undefined;
      return this.shapeEnrollment(r, {
        studentName: st?.name ?? st?.username,
        guardianName: gu?.name ?? gu?.username,
        guardianPhone: gu?.mobile,
      });
    });
  }

  async setEnrollmentStatus(session: Session, id: string, status: EnrollmentStatus): Promise<{ ok: true }> {
    const { academyId } = this.requireOwner(session);
    if (status !== "ACTIVE" && status !== "PAUSED" && status !== "ENDED") {
      throw new BadRequestException("Status must be ACTIVE, PAUSED or ENDED.");
    }
    const _id = this.oid(id);
    const r = await this.enrollments().updateOne(
      { _id, academyId },
      { $set: { status, updatedAt: new Date(), ...(status === "ENDED" ? { endsOn: new Date() } : {}) } },
    );
    if (r.matchedCount === 0) throw new NotFoundException("Enrollment not found.");
    return { ok: true };
  }

  /** List academy students, tagging which are already enrolled in the given plan.
   *  Powers the enrolment picker's "already-enrolled" grey-out state. */
  async listStudentsForEnroll(session: Session, planId: string): Promise<StudentPickRow[]> {
    const { academyId } = this.requireOwner(session);
    const pid = this.oid(planId);
    const plan = await this.plans().findOne({ _id: pid, academyId });
    if (!plan) throw new NotFoundException("Plan not found.");

    const [students, active] = await Promise.all([
      this.users().find({ academyId, role: "student" }, { projection: { _id: 1, name: 1, username: 1, parentIds: 1 } as never }).sort({ name: 1 } as never).limit(2000).toArray(),
      this.enrollments().find({ academyId, planId: String(pid), status: "ACTIVE" }, { projection: { studentUserId: 1 } as never }).toArray(),
    ]);
    const enrolledSet = new Set(active.map((e) => e.studentUserId));

    // Resolve first-parent phone in one batched query.
    const parentIds: string[] = [];
    for (const s of students) if (Array.isArray(s.parentIds) && s.parentIds.length > 0) parentIds.push(String(s.parentIds[0]));
    const parentOids: ObjectId[] = [];
    for (const p of parentIds) { try { parentOids.push(new ObjectId(p)); } catch { /* skip */ } }
    const parents = parentOids.length ? await this.users().find({ _id: { $in: parentOids } }, { projection: { _id: 1, mobile: 1 } as never }).toArray() : [];
    const parentById = new Map(parents.map((p) => [String(p._id), p]));

    return students.map((s) => {
      const sid = String(s._id);
      const pIdRaw = Array.isArray(s.parentIds) && s.parentIds.length > 0 ? String(s.parentIds[0]) : undefined;
      const parent = pIdRaw ? parentById.get(pIdRaw) : undefined;
      return {
        id: sid,
        name: s.name ?? s.username ?? "(unnamed)",
        username: s.username,
        parentPhone: parent?.mobile,
        alreadyEnrolled: enrolledSet.has(sid),
      };
    });
  }

  // ---- helpers --------------------------------------------------------------

  private oid(id: string): ObjectId {
    try { return new ObjectId(id); }
    catch { throw new BadRequestException("That's not a valid ID."); }
  }
}
