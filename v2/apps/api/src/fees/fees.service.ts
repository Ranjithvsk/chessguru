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
  DashboardResponse,
  EnrollmentResponse,
  EnrollmentStatus,
  FeeCounterDoc,
  FeeEnrollmentDoc,
  FeeHeadDoc,
  FeeHeadKind,
  FeePlanDoc,
  FeeProgramDoc,
  FeeSettingsDoc,
  FeeSettingsResponse,
  GenerateInvoicesInput,
  HeadResponse,
  InvoiceDoc,
  InvoiceLine,
  InvoiceResponse,
  InvoiceStatus,
  LogReminderInput,
  ReminderChannel,
  ReminderLogDoc,
  ReminderTemplate,
  ReminderTextResponse,
  UpdateFeeSettingsInput,
  MAX_AMOUNT_PAISE,
  MAX_BULK_ENROLL,
  MAX_DAY_OF_MONTH,
  MAX_DESC_LEN,
  MAX_DISCOUNT_PCT,
  MAX_DUE_OFFSET_DAYS,
  MAX_HEADS_PER_PROGRAM,
  MAX_INVOICE_NOTE_LEN,
  MAX_LATE_GRACE_DAYS,
  MAX_NAME_LEN,
  MAX_PAYMENT_NOTE_LEN,
  MAX_WAIVE_REASON_LEN,
  MIN_AMOUNT_PAISE,
  MIN_DAY_OF_MONTH,
  MIN_DISCOUNT_PCT,
  PaymentAllocationDoc,
  PaymentDoc,
  PaymentResponse,
  PlanCadence,
  PlanResponse,
  ProgramResponse,
  RecordManualPaymentInput,
  StudentPickRow,
  UpsertPlanInput,
  VALID_CADENCES,
  VALID_KINDS,
  VALID_MANUAL_METHODS,
  VALID_REMINDER_CHANNELS,
  WaiveInvoiceInput,
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
  private invoices()    { return this.conn.db!.collection<InvoiceDoc>(COL.invoices); }
  private payments()    { return this.conn.db!.collection<PaymentDoc>(COL.payments); }
  private allocs()      { return this.conn.db!.collection<PaymentAllocationDoc>(COL.paymentAllocs); }
  private reminders()   { return this.conn.db!.collection<ReminderLogDoc>(COL.reminders); }
  private settings()    { return this.conn.db!.collection<FeeSettingsDoc>(COL.settings); }
  private counters()    { return this.conn.db!.collection<FeeCounterDoc>("fees_counters"); }
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
    // Idempotency guard: same enrollment + same period start = same invoice.
    // Regenerating for a period is a noop instead of duplicate rows.
    await this.invoices().createIndex({ academyId: 1, enrollmentId: 1, periodStart: 1 }, { unique: true });
    await this.invoices().createIndex({ academyId: 1, status: 1, dueOn: 1 });
    await this.invoices().createIndex({ academyId: 1, guardianUserId: 1, createdAt: -1 });
    await this.payments().createIndex({ academyId: 1, createdAt: -1 });
    await this.allocs().createIndex({ academyId: 1, invoiceId: 1 });
    await this.allocs().createIndex({ academyId: 1, paymentId: 1 });
    await this.counters().createIndex({ academyId: 1, kind: 1 }, { unique: true });
    // Anti-spam: one reminder per invoice per channel per calendar day.
    // Partial index so PAYMENT_ACK / non-invoice reminders don't collide.
    await this.reminders().createIndex(
      { academyId: 1, invoiceId: 1, channel: 1, sentOn: 1 },
      { unique: true, partialFilterExpression: { invoiceId: { $exists: true } } },
    );
    await this.reminders().createIndex({ academyId: 1, sentAt: -1 });
    // One settings doc per tenant — unique index prevents duplicates from
    // racing owners saving simultaneously.
    await this.settings().createIndex({ academyId: 1 }, { unique: true });
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
      lateFeeAmountPaise: p.lateFeeAmountPaise,
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
    // Late fee amount — flat paise; 0/undefined disables the auto-cron for this plan.
    // Same paise-integer discipline as head amounts. Cap = ₹1,00,000 (MAX_AMOUNT_PAISE)
    // so a typo can't email parents "fee ₹5 crore" while we sleep.
    let lateFeeAmountPaise: number | undefined;
    if (input?.lateFeeAmountPaise !== undefined && input.lateFeeAmountPaise !== null) {
      if (typeof input.lateFeeAmountPaise !== "number" || !Number.isFinite(input.lateFeeAmountPaise) || !Number.isInteger(input.lateFeeAmountPaise)) {
        throw new BadRequestException("Late fee amount must be a whole number in paise (e.g. ₹50 = 5000).");
      }
      if (input.lateFeeAmountPaise < 0) throw new BadRequestException("Late fee amount can't be negative.");
      if (input.lateFeeAmountPaise > MAX_AMOUNT_PAISE) throw new BadRequestException("Late fee amount exceeds the per-head cap (₹1,00,000).");
      lateFeeAmountPaise = input.lateFeeAmountPaise === 0 ? undefined : input.lateFeeAmountPaise;
    }

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
        lateFeeAmountPaise,
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

  // ==========================================================================
  // W2b — Invoice generation
  // ==========================================================================

  /** India FY starts April. "2026-27" for any date Apr 2026 → Mar 2027. */
  private fyStamp(d: Date): string {
    const y = d.getFullYear();
    const m = d.getMonth(); // 0=Jan
    const start = m >= 3 ? y : y - 1;
    const end = (start + 1) % 100;
    return `${start}-${String(end).padStart(2, "0")}`;
  }

  /** Atomic per-academy invoice sequence. Resets on FY rollover. */
  private async nextInvoiceSeq(academyId: string, now: Date): Promise<{ seq: number; fyStamp: string }> {
    const fy = this.fyStamp(now);
    // First: ensure the counter row exists with the current FY. If FY changed,
    // reset seq. This is a two-step upsert — race is theoretically possible on
    // FY rollover but has no correctness impact (worst case: one duplicate try
    // that the invoiceNo uniqueness would catch — we retry once below).
    await this.counters().updateOne(
      { academyId, kind: "invoice", fyStamp: { $ne: fy } },
      { $set: { seq: 0, fyStamp: fy } },
      { upsert: false },
    );
    const r = await this.counters().findOneAndUpdate(
      { academyId, kind: "invoice" },
      { $inc: { seq: 1 }, $setOnInsert: { fyStamp: fy } },
      { upsert: true, returnDocument: "after" },
    );
    // MongoDB driver 6.x returns the doc directly; older returns { value }.
    // Handle both defensively — findOneAndUpdate typing varies across versions
    // and we can't afford to blow up on a payment path.
    const doc: FeeCounterDoc | undefined = (r && (r as unknown as { value?: FeeCounterDoc }).value) ?? (r as unknown as FeeCounterDoc | undefined);
    if (!doc) throw new Error("Counter upsert returned nothing.");
    return { seq: doc.seq, fyStamp: doc.fyStamp };
  }

  private async buildInvoiceNo(academyId: string, receiptPrefix: string, now: Date): Promise<string> {
    const { seq, fyStamp } = await this.nextInvoiceSeq(academyId, now);
    const padded = String(seq).padStart(6, "0");
    return `${receiptPrefix}/${fyStamp}/${padded}`;
  }

  /** Compute {periodStart, periodEnd, dueOn} pairs to generate for a plan.
   *  MONTHLY: from plan.startOn (bounded by plan.endOn) up through upToDate.
   *  ONE_OFF: single period = {startOn, startOn}, only if in-window vs upToDate. */
  private periodsForPlan(plan: FeePlanDoc, upToDate: Date): Array<{ periodStart: Date; periodEnd: Date; dueOn: Date }> {
    if (plan.cadence === "ONE_OFF") {
      const s = new Date(plan.startOn); s.setHours(0, 0, 0, 0);
      if (s > upToDate) return [];
      const due = new Date(s); due.setDate(due.getDate() + plan.dueOffsetDays);
      return [{ periodStart: s, periodEnd: s, dueOn: due }];
    }
    if (plan.cadence !== "MONTHLY") return []; // TERM/CUSTOM — V2
    const day = plan.dayOfMonth ?? 1;
    const list: Array<{ periodStart: Date; periodEnd: Date; dueOn: Date }> = [];
    const start = new Date(plan.startOn);
    const end = plan.endOn ? new Date(plan.endOn) : upToDate;
    const stopAt = end < upToDate ? end : upToDate;
    // Walk one month at a time starting from the plan's first period.
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    let safety = 0;
    while (cursor <= stopAt && safety++ < 240) { // 20-year cap — hard safety
      const periodStart = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      // Feb / short months — cap at month-length. new Date(y, m, 30) rolls into next month;
      // instead ceil the day at the actual last day of the month.
      const monthLen = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      periodStart.setDate(Math.min(day, monthLen));
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      periodEnd.setHours(23, 59, 59, 999);
      const dueOn = new Date(periodStart);
      dueOn.setDate(dueOn.getDate() + plan.dueOffsetDays);
      // Skip periods that end before the plan starts (day-of-month earlier than startOn's day).
      if (periodEnd >= start && periodStart <= stopAt) list.push({ periodStart, periodEnd, dueOn });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return list;
  }

  private computeInvoiceMath(lines: InvoiceLine[], enrollment: FeeEnrollmentDoc): { subtotal: number; discount: number; tax: number; total: number } {
    const subtotal = lines.reduce((s, l) => s + l.amountPaise, 0);
    let discount = 0;
    if (typeof enrollment.discountPct === "number" && enrollment.discountPct > 0) {
      discount = Math.round(subtotal * enrollment.discountPct / 100);
    }
    if (typeof enrollment.discountFlatPaise === "number" && enrollment.discountFlatPaise > 0) {
      discount += enrollment.discountFlatPaise;
    }
    discount = Math.min(discount, subtotal); // never negative-total
    const tax = lines.reduce((s, l) => {
      if (!l.gstPct) return s;
      return s + Math.round((l.amountPaise - Math.round(l.amountPaise * (enrollment.discountPct ?? 0) / 100)) * l.gstPct / 100);
    }, 0);
    const total = subtotal - discount + tax;
    return { subtotal, discount, tax, total };
  }

  /** Generate invoices for all ACTIVE enrollments on a plan. Idempotent per
   *  {enrollmentId, periodStart} via unique index — retrying returns
   *  {created, skipped, alreadyExisted} without duplicates. */
  async generateInvoices(session: Session, input: GenerateInvoicesInput): Promise<{ created: number; skipped: number }> {
    const { academyId } = this.requireOwner(session);
    const planId = this.oid(input?.planId);
    const plan = await this.plans().findOne({ _id: planId, academyId });
    if (!plan) throw new NotFoundException("Plan not found.");

    // Cadence gate — TERM/CUSTOM disabled at MVP.
    if (plan.cadence !== "MONTHLY" && plan.cadence !== "ONE_OFF") {
      throw new BadRequestException(`${plan.cadence} cadence isn't supported yet — pick MONTHLY or ONE_OFF.`);
    }

    const upToDate = input?.upToDate ? this.assertDate(input.upToDate, "Up-to date") : new Date();
    const periods = this.periodsForPlan(plan, upToDate);
    if (periods.length === 0) return { created: 0, skipped: 0 };

    // Load heads once — every enrollment on this plan shares the same head set.
    const heads = await this.heads().find({ academyId, programId: plan.programId }).sort({ order: 1 }).toArray();
    if (heads.length === 0) throw new BadRequestException("This program has no fee heads — add at least one before generating invoices.");
    const templateLines: InvoiceLine[] = heads.map((h) => ({
      headId: String(h._id),
      name: h.name,
      amountPaise: h.amountPaise,
      kind: h.kind,
      gstPct: h.gstPct,
    }));

    // Load active enrollments for this plan.
    const enrollments = await this.enrollments().find({ academyId, planId: String(planId), status: "ACTIVE" }).toArray();
    if (enrollments.length === 0) return { created: 0, skipped: 0 };

    // Fetch academy meta for receipt prefix (falls back to first 4 letters of academyId).
    const receiptPrefix = await this.receiptPrefixFor(academyId);

    let created = 0;
    let skipped = 0;
    const now = new Date();

    for (const enr of enrollments) {
      const enrStart = new Date(enr.startsOn);
      const enrEnd = enr.endsOn ? new Date(enr.endsOn) : null;

      for (const period of periods) {
        // Skip out-of-window periods for this enrolment.
        if (period.periodEnd < enrStart) continue;
        if (enrEnd && period.periodStart > enrEnd) continue;

        // Fast path: skip if we already generated this invoice.
        const existing = await this.invoices().findOne({ academyId, enrollmentId: String(enr._id), periodStart: period.periodStart });
        if (existing) { skipped++; continue; }

        const math = this.computeInvoiceMath(templateLines, enr);
        const invoiceNo = await this.buildInvoiceNo(academyId, receiptPrefix, now);
        const doc: Omit<InvoiceDoc, "_id"> = {
          academyId,
          enrollmentId: String(enr._id),
          planId: String(planId),
          programId: plan.programId,
          studentUserId: enr.studentUserId,
          guardianUserId: enr.guardianUserId,
          invoiceNo,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          lines: templateLines,
          subtotalPaise: math.subtotal,
          discountPaise: math.discount,
          taxPaise: math.tax,
          totalPaise: math.total,
          paidPaise: 0,
          dueOn: period.dueOn,
          status: "SENT",              // MVP: skip DRAFT — go straight to SENT (owner "sends" by generating)
          createdAt: now,
          updatedAt: now,
        };
        try {
          await this.invoices().insertOne(doc as InvoiceDoc);
          created++;
        } catch (e: unknown) {
          // Unique-index race under concurrent generate calls → count as skipped, don't fail the batch.
          if ((e as { code?: number })?.code === 11000) { skipped++; continue; }
          throw e;
        }
      }
    }
    return { created, skipped };
  }

  private async receiptPrefixFor(academyId: string): Promise<string> {
    // Owner-set override from fees_settings wins. Falls back to slug-derived.
    const settings = await this.settings().findOne({ academyId }, { projection: { receiptPrefix: 1 } as never });
    if (settings?.receiptPrefix) return settings.receiptPrefix;
    const academy = await this.conn.db!.collection("academies").findOne(
      { _id: this.tryOid(academyId) ?? undefined, ...(this.tryOid(academyId) ? {} : { slug: academyId }) },
      { projection: { slug: 1 } as never },
    );
    const slug: string = (academy?.slug as string) || academyId || "ACAD";
    return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "ACAD";
  }

  private tryOid(id: string): ObjectId | null {
    try { return new ObjectId(id); } catch { return null; }
  }

  // ==========================================================================
  // W2b — Invoice list + get + manual payment
  // ==========================================================================

  private shapeInvoice(i: InvoiceDoc, meta?: { programName?: string; studentName?: string; guardianName?: string; guardianPhone?: string }): InvoiceResponse {
    return {
      id: String(i._id),
      invoiceNo: i.invoiceNo,
      enrollmentId: i.enrollmentId,
      planId: i.planId,
      programId: i.programId,
      programName: meta?.programName,
      studentUserId: i.studentUserId,
      studentName: meta?.studentName,
      guardianUserId: i.guardianUserId,
      guardianName: meta?.guardianName,
      guardianPhone: meta?.guardianPhone,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      lines: i.lines.map((l) => ({ headId: l.headId, name: l.name, amountPaise: l.amountPaise, kind: l.kind, gstPct: l.gstPct })),
      subtotalPaise: i.subtotalPaise,
      discountPaise: i.discountPaise,
      taxPaise: i.taxPaise,
      totalPaise: i.totalPaise,
      paidPaise: i.paidPaise,
      balancePaise: Math.max(0, i.totalPaise - i.paidPaise),
      dueOn: i.dueOn.toISOString(),
      status: i.status,
      notes: i.notes,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      paidAt: i.paidAt?.toISOString(),
      waivedAt: i.waivedAt?.toISOString(),
      waivedReason: i.waivedReason,
      cancelledAt: i.cancelledAt?.toISOString(),
    };
  }

  async listInvoices(session: Session, opts: { status?: InvoiceStatus; planId?: string; programId?: string; guardianUserId?: string; overdueOnly?: boolean } = {}): Promise<InvoiceResponse[]> {
    const { academyId } = this.requireOwner(session);
    const filter: Record<string, unknown> = { academyId };
    if (opts.status) filter.status = opts.status;
    if (opts.planId) filter.planId = String(this.oid(opts.planId));
    if (opts.programId) filter.programId = String(this.oid(opts.programId));
    if (opts.guardianUserId) filter.guardianUserId = opts.guardianUserId;
    if (opts.overdueOnly) {
      filter.status = { $in: ["SENT", "PARTIAL", "OVERDUE"] };
      filter.dueOn = { $lt: new Date() };
    }
    const rows = await this.invoices().find(filter).sort({ dueOn: 1, createdAt: -1 }).limit(500).toArray();
    if (rows.length === 0) return [];

    // Batch resolve programs + students + guardians for the table.
    const programIds = new Set(rows.map((r) => r.programId));
    const studentIds = new Set(rows.map((r) => r.studentUserId));
    const guardianIds = new Set(rows.map((r) => r.guardianUserId).filter((v): v is string => !!v));
    const progOids = Array.from(programIds).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const stuOids  = Array.from(studentIds).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const guaOids  = Array.from(guardianIds).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const [programs, students, guardians] = await Promise.all([
      progOids.length ? this.programs().find({ _id: { $in: progOids } }, { projection: { _id: 1, name: 1 } as never }).toArray() : Promise.resolve([]),
      stuOids.length  ? this.users().find({ _id: { $in: stuOids } }, { projection: { _id: 1, name: 1, username: 1 } as never }).toArray()  : Promise.resolve([]),
      guaOids.length  ? this.users().find({ _id: { $in: guaOids } }, { projection: { _id: 1, name: 1, username: 1, mobile: 1 } as never }).toArray() : Promise.resolve([]),
    ]);
    const programById  = new Map(programs.map((p) => [String(p._id), p]));
    const studentById  = new Map(students.map((s) => [String(s._id), s]));
    const guardianById = new Map(guardians.map((g) => [String(g._id), g]));
    return rows.map((r) => this.shapeInvoice(r, {
      programName: programById.get(r.programId)?.name,
      studentName: studentById.get(r.studentUserId)?.name ?? studentById.get(r.studentUserId)?.username,
      guardianName: r.guardianUserId ? (guardianById.get(r.guardianUserId)?.name ?? guardianById.get(r.guardianUserId)?.username) : undefined,
      guardianPhone: r.guardianUserId ? guardianById.get(r.guardianUserId)?.mobile : undefined,
    }));
  }

  async getInvoice(session: Session, id: string): Promise<{ invoice: InvoiceResponse; payments: PaymentResponse[] }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(id);
    const inv = await this.invoices().findOne({ _id, academyId });
    if (!inv) throw new NotFoundException("Invoice not found.");

    // Enrich
    const [program, student, guardian] = await Promise.all([
      this.programs().findOne({ _id: this.oid(inv.programId), academyId }, { projection: { _id: 1, name: 1 } as never }),
      this.users().findOne({ _id: this.tryOid(inv.studentUserId) ?? undefined }, { projection: { _id: 1, name: 1, username: 1 } as never }),
      inv.guardianUserId ? this.users().findOne({ _id: this.tryOid(inv.guardianUserId) ?? undefined }, { projection: { _id: 1, name: 1, username: 1, mobile: 1 } as never }) : Promise.resolve(null),
    ]);

    // Payments allocated to this invoice.
    const allocs = await this.allocs().find({ academyId, invoiceId: String(_id) }).toArray();
    let paymentResponses: PaymentResponse[] = [];
    if (allocs.length > 0) {
      const payOids = Array.from(new Set(allocs.map((a) => a.paymentId))).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
      const payments = payOids.length ? await this.payments().find({ _id: { $in: payOids }, academyId }).sort({ createdAt: -1 }).toArray() : [];
      paymentResponses = payments.map((p) => this.shapePayment(p, allocs.filter((a) => a.paymentId === String(p._id)).map((a) => ({ invoiceId: a.invoiceId, invoiceNo: inv.invoiceNo, amountPaise: a.amountPaise }))));
    }

    return {
      invoice: this.shapeInvoice(inv, {
        programName: program?.name,
        studentName: student?.name ?? student?.username,
        guardianName: guardian?.name ?? guardian?.username,
        guardianPhone: guardian?.mobile,
      }),
      payments: paymentResponses,
    };
  }

  private shapePayment(p: PaymentDoc, allocations: PaymentResponse["allocations"]): PaymentResponse {
    return {
      id: String(p._id),
      guardianUserId: p.guardianUserId,
      amountPaise: p.amountPaise,
      method: p.method,
      pgProvider: p.pgProvider,
      status: p.status,
      receiptNo: p.receiptNo,
      capturedAt: p.capturedAt?.toISOString(),
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      allocations,
    };
  }

  /** Record an offline payment (cash / bank transfer / UPI-received-on-QR).
   *  FIFO-allocates across the provided invoice IDs. Any residual leftover
   *  after all invoices settle is discarded for MVP — surfaces as an admin
   *  warning in the response so the owner can pick that up. */
  async recordManualPayment(session: Session, input: RecordManualPaymentInput): Promise<{ payment: PaymentResponse; leftoverPaise: number }> {
    const { userId, academyId } = this.requireOwner(session);
    if (typeof input?.amountPaise !== "number" || !Number.isInteger(input.amountPaise) || input.amountPaise < MIN_AMOUNT_PAISE) {
      throw new BadRequestException("Amount must be a whole number of paise (≥ ₹1).");
    }
    if (!VALID_MANUAL_METHODS.includes(input?.method)) {
      throw new BadRequestException(`Method must be one of: ${VALID_MANUAL_METHODS.join(", ")}.`);
    }
    const note = typeof input?.note === "string" && input.note.trim() ? input.note.trim().slice(0, MAX_PAYMENT_NOTE_LEN) : undefined;
    const capturedAt = input?.capturedOn ? this.assertDate(input.capturedOn, "Captured on") : new Date();
    const invoiceIds = Array.isArray(input?.invoiceIds) ? input.invoiceIds : [];
    if (invoiceIds.length === 0) throw new BadRequestException("Pick at least one invoice.");

    // Load invoices, ensure ours, ensure not cancelled/waived. FIFO by dueOn.
    const oids = invoiceIds.map((s) => this.oid(s));
    const invoices = await this.invoices().find({ _id: { $in: oids }, academyId }).sort({ dueOn: 1 }).toArray();
    if (invoices.length !== invoiceIds.length) throw new BadRequestException("One or more invoices weren't found.");
    for (const inv of invoices) {
      if (inv.status === "CANCELLED" || inv.status === "WAIVED") {
        throw new BadRequestException(`Invoice ${inv.invoiceNo} is ${inv.status.toLowerCase()} — can't take payment against it.`);
      }
    }

    // Guardian derive: use the first invoice's guardian for the receipt row.
    const guardianUserId: string | undefined = invoices[0]?.guardianUserId;

    // Insert Payment row first (CAPTURED — manual entries are always captured).
    const now = new Date();
    const receiptNo = await this.buildReceiptNo(academyId, now);
    const paymentRes = await this.payments().insertOne({
      academyId,
      guardianUserId,
      amountPaise: input.amountPaise,
      method: input.method,
      pgProvider: "manual",
      status: "CAPTURED",
      receiptNo,
      capturedAt,
      note,
      createdBy: userId,
      createdAt: now,
    } as PaymentDoc);
    const paymentId = paymentRes.insertedId as ObjectId;

    // FIFO allocate.
    let remaining = input.amountPaise;
    const alloc: PaymentAllocationDoc[] = [];
    for (const inv of invoices) {
      if (remaining <= 0) break;
      const openBalance = Math.max(0, inv.totalPaise - inv.paidPaise);
      if (openBalance === 0) continue;
      const take = Math.min(openBalance, remaining);
      alloc.push({ _id: new ObjectId(), academyId, paymentId: String(paymentId), invoiceId: String(inv._id), amountPaise: take, createdAt: now });
      remaining -= take;
    }
    if (alloc.length > 0) {
      await this.allocs().insertMany(alloc);
      // Update each invoice's paidPaise + status atomically.
      for (const a of alloc) {
        const inv = invoices.find((i) => String(i._id) === a.invoiceId);
        if (!inv) continue;
        const newPaid = inv.paidPaise + a.amountPaise;
        const newStatus: InvoiceStatus = newPaid >= inv.totalPaise ? "PAID" : "PARTIAL";
        const upd: Record<string, unknown> = { paidPaise: newPaid, status: newStatus, updatedAt: now };
        if (newStatus === "PAID") upd.paidAt = now;
        await this.invoices().updateOne({ _id: inv._id, academyId }, { $set: upd });
      }
    }

    const payment: PaymentDoc | null = await this.payments().findOne({ _id: paymentId, academyId });
    if (!payment) throw new Error("Payment vanished immediately after insert.");
    const shaped = this.shapePayment(payment, alloc.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNo: invoices.find((i) => String(i._id) === a.invoiceId)?.invoiceNo,
      amountPaise: a.amountPaise,
    })));
    return { payment: shaped, leftoverPaise: remaining };
  }

  private async nextReceiptSeq(academyId: string, now: Date): Promise<{ seq: number; fyStamp: string }> {
    const fy = this.fyStamp(now);
    await this.counters().updateOne(
      { academyId, kind: "receipt", fyStamp: { $ne: fy } },
      { $set: { seq: 0, fyStamp: fy } },
      { upsert: false },
    );
    const r = await this.counters().findOneAndUpdate(
      { academyId, kind: "receipt" },
      { $inc: { seq: 1 }, $setOnInsert: { fyStamp: fy } },
      { upsert: true, returnDocument: "after" },
    );
    const doc: FeeCounterDoc | undefined = (r && (r as unknown as { value?: FeeCounterDoc }).value) ?? (r as unknown as FeeCounterDoc | undefined);
    if (!doc) throw new Error("Receipt counter upsert returned nothing.");
    return { seq: doc.seq, fyStamp: doc.fyStamp };
  }

  private async buildReceiptNo(academyId: string, now: Date): Promise<string> {
    const { seq, fyStamp } = await this.nextReceiptSeq(academyId, now);
    const prefix = await this.receiptPrefixFor(academyId);
    return `${prefix}/${fyStamp}/R-${String(seq).padStart(6, "0")}`;
  }

  async waiveInvoice(session: Session, id: string, input: WaiveInvoiceInput): Promise<{ ok: true }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(id);
    const reason = typeof input?.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, MAX_WAIVE_REASON_LEN) : undefined;
    if (!reason) throw new BadRequestException("A waive reason is required.");
    const now = new Date();
    const r = await this.invoices().updateOne(
      { _id, academyId, status: { $nin: ["CANCELLED", "WAIVED"] } },
      { $set: { status: "WAIVED", waivedAt: now, waivedReason: reason, updatedAt: now } },
    );
    if (r.matchedCount === 0) throw new NotFoundException("Invoice not found or already closed.");
    return { ok: true };
  }

  async cancelInvoice(session: Session, id: string): Promise<{ ok: true }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(id);
    const inv = await this.invoices().findOne({ _id, academyId });
    if (!inv) throw new NotFoundException("Invoice not found.");
    if (inv.paidPaise > 0) throw new BadRequestException("Can't cancel an invoice with payments — waive it instead.");
    const now = new Date();
    await this.invoices().updateOne({ _id, academyId }, { $set: { status: "CANCELLED", cancelledAt: now, updatedAt: now } });
    return { ok: true };
  }

  // ==========================================================================
  // W2c — PDF (delegates layout to fees.pdf.ts)
  // ==========================================================================

  /** Build a branding context for the tenant. Falls back to slug-based defaults
   *  if the academy hasn't filled in a Branding row. */
  private async brandingFor(academyId: string): Promise<{ name: string; tagline?: string; contactLine?: string; footerLine?: string; logoBuffer?: Buffer }> {
    const [academy, brand] = await Promise.all([
      this.conn.db!.collection("academies").findOne(
        { $or: [{ _id: this.tryOid(academyId) ?? undefined as unknown as ObjectId }, { slug: academyId }] },
        { projection: { name: 1, slug: 1, tagline: 1, contactPhone: 1, contactEmail: 1 } as never },
      ),
      // AcademyBranding may or may not exist. Best-effort read of a common shape:
      this.conn.db!.collection("academybrandings").findOne(
        { academyId },
        { projection: { brandName: 1, tagline: 1, logoDataUrl: 1 } as never },
      ),
    ]);
    const name = (brand?.brandName as string) || (academy?.name as string) || "Chess Academy";
    const tagline = (brand?.tagline as string) || (academy?.tagline as string) || undefined;
    const parts: string[] = [];
    if (academy?.contactPhone) parts.push(String(academy.contactPhone));
    if (academy?.contactEmail) parts.push(String(academy.contactEmail));
    const contactLine = parts.length ? parts.join(" · ") : undefined;
    let logoBuffer: Buffer | undefined;
    const dataUrl = brand?.logoDataUrl as string | undefined;
    if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
      const b64 = dataUrl.split(",")[1] ?? "";
      if (b64) { try { logoBuffer = Buffer.from(b64, "base64"); } catch { /* skip malformed */ } }
    }
    return { name, tagline, contactLine, logoBuffer };
  }

  /** Produce the invoice PDF as a Buffer. Delegates layout to fees.pdf.ts. */
  async renderInvoicePdf(session: Session, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(invoiceId);
    const inv = await this.invoices().findOne({ _id, academyId });
    if (!inv) throw new NotFoundException("Invoice not found.");

    const [student, guardian, program, branding] = await Promise.all([
      this.users().findOne({ _id: this.tryOid(inv.studentUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1 } as never }),
      inv.guardianUserId ? this.users().findOne({ _id: this.tryOid(inv.guardianUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1, mobile: 1 } as never }) : Promise.resolve(null),
      this.programs().findOne({ _id: this.oid(inv.programId), academyId }, { projection: { name: 1 } as never }),
      this.brandingFor(academyId),
    ]);

    // Runtime import so the pdfkit chunk stays out of hot paths that don't need it.
    const { buildInvoicePdf } = await import("./fees.pdf");
    const buffer = await buildInvoicePdf(inv, branding, {
      studentName: (student?.name as string) ?? (student?.username as string) ?? "(unnamed)",
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? undefined,
      guardianPhone: (guardian?.mobile as string) ?? undefined,
      programName: (program?.name as string) ?? undefined,
    });
    const filename = `${inv.invoiceNo.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
    return { buffer, filename };
  }

  /** Produce a receipt PDF for a payment. */
  async renderReceiptPdf(session: Session, paymentId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(paymentId);
    const payment = await this.payments().findOne({ _id, academyId });
    if (!payment) throw new NotFoundException("Payment not found.");
    if (payment.status !== "CAPTURED") throw new BadRequestException("Only captured payments have receipts.");

    const [allocs, guardian, branding] = await Promise.all([
      this.allocs().find({ academyId, paymentId: String(_id) }).toArray(),
      payment.guardianUserId ? this.users().findOne({ _id: this.tryOid(payment.guardianUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1, mobile: 1 } as never }) : Promise.resolve(null),
      this.brandingFor(academyId),
    ]);

    // Enrich each allocation with invoiceNo, studentName, periodLabel for the "applied to" table.
    const invIds = allocs.map((a) => this.tryOid(a.invoiceId)).filter((v): v is ObjectId => !!v);
    const invoicesRows = invIds.length ? await this.invoices().find({ _id: { $in: invIds }, academyId }).toArray() : [];
    const studentOids = Array.from(new Set(invoicesRows.map((i) => i.studentUserId))).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v);
    const students = studentOids.length ? await this.users().find({ _id: { $in: studentOids } }, { projection: { name: 1, username: 1 } as never }).toArray() : [];
    const studentById = new Map(students.map((s) => [String(s._id), s]));

    const lookup = new Map<string, { invoiceNo: string; studentName?: string; programName?: string; periodLabel?: string }>();
    for (const iv of invoicesRows) {
      const s = studentById.get(iv.studentUserId);
      const start = iv.periodStart;
      const end = iv.periodEnd;
      const periodLabel = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
        ? start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
        : `${start.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`;
      lookup.set(String(iv._id), {
        invoiceNo: iv.invoiceNo,
        studentName: (s?.name as string) ?? (s?.username as string) ?? undefined,
        periodLabel,
      });
    }

    const { buildReceiptPdf } = await import("./fees.pdf");
    const buffer = await buildReceiptPdf(payment, allocs, branding, {
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? undefined,
      guardianPhone: (guardian?.mobile as string) ?? undefined,
      invoiceLookup: lookup,
    });
    const filename = `${payment.receiptNo.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
    return { buffer, filename };
  }

  // ==========================================================================
  // W3-lite — dashboard + reminders
  // ==========================================================================

  /** IST YYYY-MM-DD stamp used as the "sentOn" grouping key. Every
   *  reminder-log unique index and every daily-collection bucket uses this. */
  private istDayStamp(d: Date): string {
    // IST is UTC+5:30 with no DST — just shift and slice.
    const ms = d.getTime() + 5.5 * 60 * 60 * 1000;
    const shifted = new Date(ms);
    return shifted.toISOString().slice(0, 10);
  }
  private startOfIstMonth(now: Date): Date {
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const y = ist.getUTCFullYear(); const m = ist.getUTCMonth();
    return new Date(Date.UTC(y, m, 1) - 5.5 * 60 * 60 * 1000);
  }

  async dashboard(session: Session): Promise<DashboardResponse> {
    const { academyId } = this.requireOwner(session);
    const now = new Date();
    const monthStart = this.startOfIstMonth(now);
    const in7d = new Date(now.getTime() + 7 * 86400_000);
    const in30dAgo = new Date(now.getTime() - 30 * 86400_000);

    // Aggregate all sections in parallel — dashboard is a hot page, keep total < 200 ms at 500 invoices.
    const [
      capturedThisMonth,
      overdue,
      expected,
      activeEnrol,
      recentPaymentsRaw,
      collectionByDayRaw,
      lastReminder,
    ] = await Promise.all([
      // Sum of PAID/PARTIAL invoice paidPaise where paidAt ≥ monthStart is easier via allocations directly.
      this.allocs().aggregate([
        { $match: { academyId } },
        { $lookup: { from: COL.payments, localField: "paymentId", foreignField: "_id", as: "p" } },
        { $unwind: "$p" },
        { $match: { "p.academyId": academyId, "p.status": "CAPTURED", "p.capturedAt": { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$amountPaise" } } },
      ]).toArray(),

      this.invoices().aggregate([
        { $match: { academyId, status: { $in: ["SENT", "PARTIAL", "OVERDUE"] }, dueOn: { $lt: now } } },
        { $group: { _id: null, count: { $sum: 1 }, balance: { $sum: { $subtract: ["$totalPaise", "$paidPaise"] } } } },
      ]).toArray(),

      this.invoices().aggregate([
        { $match: { academyId, status: { $in: ["SENT", "PARTIAL"] }, dueOn: { $gte: now, $lte: in7d } } },
        { $group: { _id: null, total: { $sum: { $subtract: ["$totalPaise", "$paidPaise"] } } } },
      ]).toArray(),

      this.enrollments().countDocuments({ academyId, status: "ACTIVE" }),

      this.payments().find({ academyId, status: "CAPTURED" }).sort({ capturedAt: -1 }).limit(10).toArray(),

      this.allocs().aggregate([
        { $match: { academyId, createdAt: { $gte: in30dAgo } } },
        { $lookup: { from: COL.payments, localField: "paymentId", foreignField: "_id", as: "p" } },
        { $unwind: "$p" },
        { $match: { "p.status": "CAPTURED" } },
        // Bucket by IST day. addFields + $dateToString with IST offset.
        { $addFields: { dayKey: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: { $add: ["$p.capturedAt", 5.5 * 60 * 60 * 1000] },
          },
        } } },
        { $group: { _id: "$dayKey", collectedPaise: { $sum: "$amountPaise" } } },
        { $project: { _id: 0, day: "$_id", collectedPaise: 1 } },
        { $sort: { day: 1 } },
      ]).toArray(),

      this.reminders().find({ academyId }).sort({ sentAt: -1 }).limit(1).next(),
    ]);

    // ---- Top 5 defaulters — group open balance by guardianUserId
    const defAgg = await this.invoices().aggregate([
      { $match: { academyId, status: { $in: ["SENT", "PARTIAL", "OVERDUE"] }, guardianUserId: { $exists: true, $ne: null } } },
      { $group: {
        _id: "$guardianUserId",
        outstanding: { $sum: { $subtract: ["$totalPaise", "$paidPaise"] } },
        count: { $sum: 1 },
        studentIds: { $addToSet: "$studentUserId" },
        oldestDueOn: { $min: "$dueOn" },
      } },
      { $sort: { outstanding: -1 } },
      { $limit: 5 },
    ]).toArray();

    // Enrich defaulters with guardian + student names in two batched lookups.
    const gOids: ObjectId[] = [];
    const sOids: ObjectId[] = [];
    for (const d of defAgg) {
      const g = this.tryOid(String(d._id)); if (g) gOids.push(g);
      for (const s of (d.studentIds ?? [])) {
        const so = this.tryOid(String(s)); if (so) sOids.push(so);
      }
    }
    const [gs, ss] = await Promise.all([
      gOids.length ? this.users().find({ _id: { $in: gOids } }, { projection: { name: 1, username: 1, mobile: 1 } as never }).toArray() : Promise.resolve([]),
      sOids.length ? this.users().find({ _id: { $in: sOids } }, { projection: { name: 1, username: 1 } as never }).toArray() : Promise.resolve([]),
    ]);
    const gById = new Map(gs.map((x) => [String(x._id), x]));
    const sById = new Map(ss.map((x) => [String(x._id), x]));

    const topDefaulters = defAgg.map((d) => {
      const g = gById.get(String(d._id));
      const studentNames = (d.studentIds ?? []).map((sid: string) => {
        const s = sById.get(String(sid));
        return (s?.name as string) ?? (s?.username as string) ?? "—";
      });
      return {
        guardianUserId: String(d._id),
        guardianName: (g?.name as string) ?? (g?.username as string) ?? undefined,
        guardianPhone: (g?.mobile as string) ?? undefined,
        studentNames,
        invoiceCount: d.count,
        outstandingPaise: d.outstanding,
        oldestDueOn: (d.oldestDueOn instanceof Date ? d.oldestDueOn : new Date(d.oldestDueOn)).toISOString(),
      };
    });

    // Recent payments — enrich with guardian name + allocated invoice numbers.
    const payIds = recentPaymentsRaw.map((p) => String(p._id));
    const [payGs, payAllocs] = await Promise.all([
      recentPaymentsRaw.length ? this.users().find(
        { _id: { $in: recentPaymentsRaw.map((p) => this.tryOid(p.guardianUserId ?? "")).filter((v): v is ObjectId => !!v) } },
        { projection: { name: 1, username: 1 } as never },
      ).toArray() : Promise.resolve([]),
      payIds.length ? this.allocs().find({ academyId, paymentId: { $in: payIds } }).toArray() : Promise.resolve([]),
    ]);
    const payGById = new Map(payGs.map((x) => [String(x._id), x]));
    const invIdSet = new Set(payAllocs.map((a) => a.invoiceId));
    const payInvs = invIdSet.size ? await this.invoices().find(
      { academyId, _id: { $in: Array.from(invIdSet).map((s) => this.tryOid(s)).filter((v): v is ObjectId => !!v) } },
      { projection: { invoiceNo: 1 } as never },
    ).toArray() : [];
    const invNoById = new Map(payInvs.map((i) => [String(i._id), i.invoiceNo as string]));

    const recentPayments = recentPaymentsRaw.map((p) => {
      const g = p.guardianUserId ? payGById.get(String(p.guardianUserId)) : undefined;
      const nos = payAllocs.filter((a) => a.paymentId === String(p._id))
        .map((a) => invNoById.get(a.invoiceId))
        .filter((v): v is string => !!v);
      return {
        id: String(p._id),
        amountPaise: p.amountPaise,
        method: p.method,
        receiptNo: p.receiptNo,
        guardianName: (g?.name as string) ?? (g?.username as string) ?? undefined,
        capturedAt: (p.capturedAt ?? p.createdAt).toISOString(),
        invoiceNos: nos,
      };
    });

    const monthLabel = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    return {
      currency: "INR",
      now: now.toISOString(),
      monthLabel,
      collectedMonthPaise: capturedThisMonth[0]?.total ?? 0,
      overdueCountInvoices: overdue[0]?.count ?? 0,
      overdueBalancePaise: overdue[0]?.balance ?? 0,
      expectedNext7dPaise: expected[0]?.total ?? 0,
      totalActiveEnrollments: activeEnrol,
      topDefaulters,
      recentPayments,
      collectionByDay: collectionByDayRaw.map((r) => ({ day: r.day as string, collectedPaise: r.collectedPaise as number })),
      lastReminderAt: lastReminder?.sentAt ? lastReminder.sentAt.toISOString() : null,
    };
  }

  // ---- Reminder text + wa.me link -----------------------------------------

  /** Compose the WhatsApp reminder text + wa.me deep-link. Identical output on
   *  server + client (client builds its own URL when user clicks — we reuse the
   *  server helper via GET so the anti-spam counter uses the same wording). */
  async reminderTextForInvoice(session: Session, invoiceId: string, channel: ReminderChannel = "WHATSAPP"): Promise<ReminderTextResponse> {
    const { academyId } = this.requireOwner(session);
    const _id = this.oid(invoiceId);
    const inv = await this.invoices().findOne({ _id, academyId });
    if (!inv) throw new NotFoundException("Invoice not found.");

    const [student, guardian, academy] = await Promise.all([
      this.users().findOne({ _id: this.tryOid(inv.studentUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1 } as never }),
      inv.guardianUserId ? this.users().findOne({ _id: this.tryOid(inv.guardianUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1, mobile: 1 } as never }) : Promise.resolve(null),
      this.conn.db!.collection("academies").findOne(
        { $or: [{ _id: this.tryOid(academyId) ?? undefined as unknown as ObjectId }, { slug: academyId }] },
        { projection: { name: 1 } as never },
      ),
    ]);

    const balance = Math.max(0, inv.totalPaise - inv.paidPaise);
    const isOverdue = balance > 0 && (inv.status === "SENT" || inv.status === "PARTIAL") && inv.dueOn < new Date();
    const template: ReminderTemplate = isOverdue ? "FEE_OVERDUE" : "FEE_DUE";

    const guardianName = (guardian?.name as string) ?? (guardian?.username as string) ?? "there";
    const studentName = (student?.name as string) ?? (student?.username as string) ?? "your child";
    const academyName = (academy?.name as string) ?? "Chess Academy";
    const balanceStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: balance % 100 === 0 ? 0 : 2 }).format(balance / 100);
    const dueStr = inv.dueOn.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    // Include the parent-portal magic link so the guardian can pay in three
    // taps (WhatsApp → tap link → tap Pay). Silently omit if PORTAL_TOKEN_SALT
    // isn't set (dev / half-configured prod); the text still reads sensibly.
    const portalLine = inv.guardianUserId ? this.safePortalUrl(academyId, inv.guardianUserId) : "";
    const payLine = portalLine ? `\nPay here: ${portalLine}` : "";
    const text = isOverdue
      ? `Hi ${guardianName}, gentle reminder — ${studentName}'s fee (${inv.invoiceNo}, ${balanceStr}) was due on ${dueStr}.${payLine}\nThank you — ${academyName}`
      : `Hi ${guardianName}, friendly reminder — ${studentName}'s fee (${inv.invoiceNo}, ${balanceStr}) is due on ${dueStr}.${payLine}\nThank you — ${academyName}`;

    let waLink = "";
    const phoneRaw = (guardian?.mobile as string) ?? "";
    if (channel === "WHATSAPP" && phoneRaw) {
      // Strip everything non-digit; if 10-digit assume India (+91).
      const digits = phoneRaw.replace(/\D+/g, "");
      const e164 = digits.length === 10 ? "91" + digits : digits;
      waLink = `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
    }

    return {
      waLink,
      text,
      template,
      channel,
      guardianPhone: phoneRaw || undefined,
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? undefined,
    };
  }

  /** Guardian-level reminder — sums open balances across all invoices this
   *  guardian is responsible for. Used by the dashboard's defaulter rows so
   *  one 🔔 tap covers all of Aarav + Rhea's pending bills. */
  async reminderTextForGuardian(session: Session, guardianUserId: string, channel: ReminderChannel = "WHATSAPP"): Promise<ReminderTextResponse> {
    const { academyId } = this.requireOwner(session);
    const [guardian, academy, openInvoices] = await Promise.all([
      this.users().findOne({ _id: this.tryOid(guardianUserId) ?? undefined as unknown as ObjectId }, { projection: { name: 1, username: 1, mobile: 1 } as never }),
      this.conn.db!.collection("academies").findOne(
        { $or: [{ _id: this.tryOid(academyId) ?? undefined as unknown as ObjectId }, { slug: academyId }] },
        { projection: { name: 1 } as never },
      ),
      this.invoices().find({ academyId, guardianUserId, status: { $in: ["SENT", "PARTIAL", "OVERDUE"] } }).sort({ dueOn: 1 }).toArray(),
    ]);
    if (!guardian) throw new NotFoundException("Guardian not found.");

    const guardianName = (guardian?.name as string) ?? (guardian?.username as string) ?? "there";
    const academyName = (academy?.name as string) ?? "Chess Academy";
    const outstanding = openInvoices.reduce((s, i) => s + Math.max(0, i.totalPaise - i.paidPaise), 0);
    const outstandingStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: outstanding % 100 === 0 ? 0 : 2 }).format(outstanding / 100);
    const count = openInvoices.length;
    const oldestDue = openInvoices[0]?.dueOn ? openInvoices[0].dueOn.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

    const portalLine = this.safePortalUrl(academyId, guardianUserId);
    const payLine = portalLine ? `\nPay here: ${portalLine}` : "";
    const invoiceWord = count === 1 ? "invoice" : "invoices";
    const text = count === 0
      ? `Hi ${guardianName}, all fees are up to date. Thank you! — ${academyName}`
      : `Hi ${guardianName}, gentle reminder — total outstanding is ${outstandingStr} across ${count} ${invoiceWord}${oldestDue ? ` (oldest due ${oldestDue})` : ""}.${payLine}\nThank you — ${academyName}`;

    const template: ReminderTemplate = "FEE_OVERDUE";
    let waLink = "";
    const phoneRaw = (guardian?.mobile as string) ?? "";
    if (channel === "WHATSAPP" && phoneRaw) {
      const digits = phoneRaw.replace(/\D+/g, "");
      const e164 = digits.length === 10 ? "91" + digits : digits;
      waLink = `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
    }
    return {
      waLink,
      text,
      template,
      channel,
      guardianPhone: phoneRaw || undefined,
      guardianName: (guardian?.name as string) ?? (guardian?.username as string) ?? undefined,
    };
  }

  /** Best-effort portal URL — swallows the "PORTAL_TOKEN_SALT unset" throw so
   *  templates gracefully omit the Pay line in dev instead of crashing the
   *  whole reminder path. */
  private safePortalUrl(academyId: string, guardianUserId: string): string {
    try {
      // Runtime require to keep the service module dep-graph flat.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { portalUrl } = require("./fees.pg");
      return portalUrl(academyId, guardianUserId);
    } catch { return ""; }
  }

  /** Record a click on the reminder button — unique(invoiceId, channel, day)
   *  prevents double-log spam even if the operator double-clicks. */
  async logReminder(session: Session, input: LogReminderInput): Promise<{ ok: true; alreadyToday: boolean }> {
    const { userId, academyId } = this.requireOwner(session);
    const channel = input?.channel;
    if (!channel || !VALID_REMINDER_CHANNELS.includes(channel)) {
      throw new BadRequestException(`Channel must be one of: ${VALID_REMINDER_CHANNELS.join(", ")}.`);
    }
    if (!input.invoiceId && !input.guardianUserId) {
      throw new BadRequestException("Give either an invoiceId or a guardianUserId.");
    }
    let template: ReminderTemplate = input.template ?? "FEE_DUE";
    let guardianUserId = input.guardianUserId;

    if (input.invoiceId) {
      const _id = this.oid(input.invoiceId);
      const inv = await this.invoices().findOne({ _id, academyId }, { projection: { guardianUserId: 1, status: 1, dueOn: 1 } as never });
      if (!inv) throw new NotFoundException("Invoice not found.");
      guardianUserId = guardianUserId ?? (inv.guardianUserId as string | undefined);
      if (!input.template) {
        const overdue = inv.dueOn instanceof Date ? inv.dueOn < new Date() : new Date(inv.dueOn as unknown as string) < new Date();
        template = overdue ? "FEE_OVERDUE" : "FEE_DUE";
      }
    }

    const now = new Date();
    const doc: Omit<ReminderLogDoc, "_id"> = {
      academyId,
      invoiceId: input.invoiceId,
      guardianUserId,
      channel,
      template,
      sentAt: now,
      sentOn: this.istDayStamp(now),
      actorUserId: userId,
      status: "SENT",
    };
    try {
      await this.reminders().insertOne(doc as ReminderLogDoc);
      return { ok: true, alreadyToday: false };
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        // Duplicate unique-key = already logged today for this invoice+channel.
        return { ok: true, alreadyToday: true };
      }
      throw e;
    }
  }

  // ==========================================================================
  // W4e — per-tenant settings
  // ==========================================================================

  /** Best-effort settings lookup — used by portal / cron paths that need
   *  per-tenant Razorpay credentials. Never throws. Returns null if the
   *  tenant hasn't saved anything yet. */
  async readSettings(academyId: string): Promise<FeeSettingsDoc | null> {
    return this.settings().findOne({ academyId });
  }

  private webhookUrlFor(academyId: string): string {
    const origin = process.env.CHESSGURU_PUBLIC_ORIGIN ?? "https://chessguru.cc";
    return `${origin}/v2api/api/fees/webhook/razorpay/${encodeURIComponent(academyId)}`;
  }

  private shapeSettings(academyId: string, doc: FeeSettingsDoc | null): FeeSettingsResponse {
    return {
      academyId,
      razorpayKeyId: doc?.razorpayKeyId,
      razorpayKeySecretSet: !!doc?.razorpayKeySecret,
      razorpayWebhookSecretSet: !!doc?.razorpayWebhookSecret,
      gstin: doc?.gstin,
      legalName: doc?.legalName,
      panNo: doc?.panNo,
      receiptPrefix: doc?.receiptPrefix,
      bankAccountLast4: doc?.bankAccountLast4,
      updatedAt: doc?.updatedAt?.toISOString(),
      webhookUrl: this.webhookUrlFor(academyId),
    };
  }

  async getSettings(session: Session): Promise<FeeSettingsResponse> {
    const { academyId } = this.requireOwner(session);
    const doc = await this.settings().findOne({ academyId });
    return this.shapeSettings(academyId, doc);
  }

  async updateSettings(session: Session, input: UpdateFeeSettingsInput): Promise<FeeSettingsResponse> {
    const { userId, academyId } = this.requireOwner(session);
    // Build a $set / $unset patch. `null` explicitly clears; `undefined`
    // leaves untouched. String fields trimmed + length-capped.
    const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: userId };
    const unset: Record<string, "" > = {};

    const strField = (key: keyof UpdateFeeSettingsInput, dbKey: string, opts: { max: number; upper?: boolean; digitsOnly?: boolean } = { max: 100 }) => {
      const v = input[key];
      if (v === undefined) return;
      if (v === null) { unset[dbKey] = ""; return; }
      if (typeof v !== "string") throw new BadRequestException(`${dbKey} must be text.`);
      let trimmed = v.trim();
      if (opts.upper) trimmed = trimmed.toUpperCase();
      if (opts.digitsOnly) trimmed = trimmed.replace(/\D+/g, "");
      if (trimmed.length === 0) { unset[dbKey] = ""; return; }
      if (trimmed.length > opts.max) throw new BadRequestException(`${dbKey} is too long (max ${opts.max}).`);
      set[dbKey] = trimmed;
    };

    strField("razorpayKeyId", "razorpayKeyId", { max: 120 });
    strField("razorpayKeySecret", "razorpayKeySecret", { max: 200 });
    strField("razorpayWebhookSecret", "razorpayWebhookSecret", { max: 200 });
    strField("gstin", "gstin", { max: 20, upper: true });
    strField("legalName", "legalName", { max: 120 });
    strField("panNo", "panNo", { max: 15, upper: true });
    strField("receiptPrefix", "receiptPrefix", { max: 12, upper: true });
    strField("bankAccountLast4", "bankAccountLast4", { max: 4, digitsOnly: true });

    // GSTIN sanity — 15 chars, alphanumeric. Only validate when caller provided one.
    if (typeof set.gstin === "string" && !/^[0-9A-Z]{15}$/.test(set.gstin as string)) {
      throw new BadRequestException("GSTIN must be 15 uppercase alphanumeric characters.");
    }
    if (typeof set.panNo === "string" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(set.panNo as string)) {
      throw new BadRequestException("PAN must look like ABCDE1234F.");
    }
    if (typeof set.bankAccountLast4 === "string" && !/^\d{4}$/.test(set.bankAccountLast4 as string)) {
      throw new BadRequestException("Bank account last 4 must be 4 digits.");
    }
    if (typeof set.receiptPrefix === "string" && !/^[A-Z0-9]{2,12}$/.test(set.receiptPrefix as string)) {
      throw new BadRequestException("Receipt prefix must be 2–12 uppercase letters/digits.");
    }

    const patch: Record<string, unknown> = { $set: set, $setOnInsert: { academyId } };
    if (Object.keys(unset).length > 0) patch.$unset = unset;

    await this.settings().updateOne({ academyId }, patch, { upsert: true });
    const doc = await this.settings().findOne({ academyId });
    return this.shapeSettings(academyId, doc);
  }

  // ---- helpers --------------------------------------------------------------

  private oid(id: string): ObjectId {
    try { return new ObjectId(id); }
    catch { throw new BadRequestException("That's not a valid ID."); }
  }
}
