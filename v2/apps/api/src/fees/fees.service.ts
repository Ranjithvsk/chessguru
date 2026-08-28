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
  COL,
  CreateProgramInput,
  FeeHeadDoc,
  FeeHeadKind,
  FeeProgramDoc,
  HeadResponse,
  MAX_AMOUNT_PAISE,
  MAX_DESC_LEN,
  MAX_HEADS_PER_PROGRAM,
  MAX_NAME_LEN,
  MIN_AMOUNT_PAISE,
  ProgramResponse,
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

  private programs() { return this.conn.db!.collection<FeeProgramDoc>(COL.programs); }
  private heads()    { return this.conn.db!.collection<FeeHeadDoc>(COL.heads); }

  // Called on module init to make sure the indices we count on for tenant scoping
  // and lookup are present. Idempotent — createIndex is a no-op on second run.
  async ensureIndices() {
    await this.programs().createIndex({ academyId: 1, status: 1, updatedAt: -1 });
    await this.heads().createIndex({ academyId: 1, programId: 1, order: 1 });
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

  // ---- helpers --------------------------------------------------------------

  private oid(id: string): ObjectId {
    try { return new ObjectId(id); }
    catch { throw new BadRequestException("That's not a valid ID."); }
  }
}
