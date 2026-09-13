import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";

/** Academy accounting (2026-09-13) — one ledger per academy: expenses (rent, coach salary,
 *  utilities, materials…), manual income, and a monthly P&L that also counts the fees actually
 *  collected (captured payments in `fees_payments`). Strictly tenant-scoped: every read and write
 *  is filtered by session.academyId, exactly like the fees module, so no academy sees another's
 *  books. Amounts are integer paise throughout. Owner-only.
 *
 *  This is a cash ledger, not double-entry bookkeeping — income in, expenses out, net per month —
 *  which is what an academy needs to see profit, coach payouts and rent in one place.
 */

export const EXPENSE_CATEGORIES = ["rent", "coach_salary", "utilities", "materials", "marketing", "software", "travel", "maintenance", "misc"] as const;
export const INCOME_CATEGORIES = ["fees_manual", "coaching_camp", "tournament", "merchandise", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type LedgerDirection = "expense" | "income";

const MAX_PAISE = 100_00_00_000; // ₹10 crore per entry — a sanity ceiling
const CAT_LABEL: Record<string, string> = {
  rent: "Rent", coach_salary: "Coach salary", utilities: "Utilities", materials: "Materials", marketing: "Marketing",
  software: "Software", travel: "Travel", maintenance: "Maintenance", misc: "Miscellaneous",
  fees_manual: "Fees (manual)", coaching_camp: "Camp / workshop", tournament: "Tournament", merchandise: "Merchandise", other: "Other",
  fees_collected: "Fees collected online",
};

type EntryDoc = {
  _id: ObjectId; academyId: string;
  direction: LedgerDirection; category: string; amountPaise: number;
  date: Date; note: string;
  payeeType: "coach" | "vendor" | "other" | null;
  coachUserId: string | null; payeeName: string;
  recurring: "monthly" | null;
  createdBy: string; createdAt: Date; updatedAt: Date;
};

@Injectable()
export class FinanceService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private entries() { return this.conn.db!.collection<EntryDoc>("academyLedger"); }
  private users() { return this.conn.db!.collection("users"); }
  private payments() { return this.conn.db!.collection("fees_payments"); }

  async ensureIndexes() {
    await this.entries().createIndex({ academyId: 1, date: -1 });
    await this.entries().createIndex({ academyId: 1, direction: 1, category: 1 });
  }

  /** Owner-only tenant guard — mirrors AcademyService.ensureOwner. */
  private ensureOwner(session: any): { academyId: string; userId: string } {
    const academyId = session?.academyId;
    if (session?.role !== "academy_owner" || !academyId) throw new ForbiddenException("academy owner only");
    return { academyId, userId: String(session.userId) };
  }

  private assertAmount(v: unknown): number {
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) throw new BadRequestException("amount must be a whole number of paise ≥ ₹1");
    if (v > MAX_PAISE) throw new BadRequestException("amount is implausibly large");
    return v;
  }
  private monthRange(month?: string): { start: Date; end: Date; key: string } {
    // month = "YYYY-MM" in IST; default current IST month.
    const now = new Date();
    let y: number, m: number;
    if (month && /^\d{4}-\d{2}$/.test(month)) { const parts = month.split("-"); y = +(parts[0] ?? "0"); m = +(parts[1] ?? "1") - 1; }
    else { const ist = new Date(now.getTime() + 330 * 60000); y = ist.getUTCFullYear(); m = ist.getUTCMonth(); }
    // IST midnight = 18:30 UTC previous day
    const start = new Date(Date.UTC(y, m, 1, -5, -30, 0));
    const end = new Date(Date.UTC(y, m + 1, 1, -5, -30, 0));
    return { start, end, key: `${y}-${String(m + 1).padStart(2, "0")}` };
  }

  async list(session: any, month?: string) {
    const { academyId } = this.ensureOwner(session);
    const filter: Record<string, unknown> = { academyId };
    if (month) { const { start, end } = this.monthRange(month); filter.date = { $gte: start, $lt: end }; }
    const rows = await this.entries().find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).toArray();
    return rows.map(serialize);
  }

  async coaches(session: any) {
    const { academyId } = this.ensureOwner(session);
    const rows = await this.users().find({ academyId, role: { $in: ["academy_owner", "coach"] } }, { projection: { _id: 1, username: 1, role: 1 } }).toArray();
    return rows.map((r: any) => ({ userId: String(r._id), name: r.username, isOwner: r.role === "academy_owner" }))
      .sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0));
  }

  async create(session: any, body: any) {
    const { academyId, userId } = this.ensureOwner(session);
    const direction: LedgerDirection = body?.direction === "income" ? "income" : "expense";
    const cats = direction === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const category = (cats as readonly string[]).includes(body?.category) ? body.category : (direction === "expense" ? "misc" : "other");
    const amountPaise = this.assertAmount(body?.amountPaise);
    const date = body?.date && !isNaN(new Date(body.date).getTime()) ? new Date(body.date) : new Date();
    const now = new Date();
    let coachUserId: string | null = null, payeeName = String(body?.payeeName ?? "").trim().slice(0, 120);
    let payeeType: EntryDoc["payeeType"] = body?.payeeType === "coach" || body?.payeeType === "vendor" || body?.payeeType === "other" ? body.payeeType : null;
    if (category === "coach_salary" && body?.coachUserId) {
      const c: any = await this.users().findOne({ _id: String(body.coachUserId), academyId } as any, { projection: { username: 1 } });
      if (c) { coachUserId = String(c._id); payeeType = "coach"; if (!payeeName) payeeName = c.username; }
    }
    const doc: EntryDoc = {
      _id: new ObjectId(), academyId, direction, category, amountPaise, date,
      note: String(body?.note ?? "").trim().slice(0, 500), payeeType, coachUserId, payeeName,
      recurring: body?.recurring === "monthly" ? "monthly" : null, createdBy: userId, createdAt: now, updatedAt: now,
    };
    await this.entries().insertOne(doc);
    return serialize(doc);
  }

  async update(session: any, id: string, body: any) {
    const { academyId } = this.ensureOwner(session);
    let _id: ObjectId; try { _id = new ObjectId(id); } catch { throw new BadRequestException("bad id"); }
    const cur = await this.entries().findOne({ _id, academyId });
    if (!cur) throw new BadRequestException("not found");
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if ("amountPaise" in body) set.amountPaise = this.assertAmount(body.amountPaise);
    if ("note" in body) set.note = String(body.note ?? "").trim().slice(0, 500);
    if ("date" in body && !isNaN(new Date(body.date).getTime())) set.date = new Date(body.date);
    if ("payeeName" in body) set.payeeName = String(body.payeeName ?? "").trim().slice(0, 120);
    if ("recurring" in body) set.recurring = body.recurring === "monthly" ? "monthly" : null;
    if ("category" in body) {
      const cats = cur.direction === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
      if ((cats as readonly string[]).includes(body.category)) set.category = body.category;
    }
    await this.entries().updateOne({ _id, academyId }, { $set: set });
    const updated = await this.entries().findOne({ _id, academyId });
    return updated ? serialize(updated) : null;
  }

  async remove(session: any, id: string) {
    const { academyId } = this.ensureOwner(session);
    let _id: ObjectId; try { _id = new ObjectId(id); } catch { throw new BadRequestException("bad id"); }
    await this.entries().deleteOne({ _id, academyId });
    return { ok: true };
  }

  /** Monthly P&L: manual ledger income + fees collected online, minus expenses by category. */
  async summary(session: any, month?: string) {
    const { academyId } = this.ensureOwner(session);
    const { start, end, key } = this.monthRange(month);

    const byCat = await this.entries().aggregate<{ _id: { direction: string; category: string }; total: number }>([
      { $match: { academyId, date: { $gte: start, $lt: end } } },
      { $group: { _id: { direction: "$direction", category: "$category" }, total: { $sum: "$amountPaise" } } },
    ]).toArray();

    const feesAgg = await this.payments().aggregate<{ total: number }>([
      { $match: { academyId, status: "CAPTURED", capturedAt: { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: "$amountPaise" } } },
    ]).toArray();
    const feesCollected = feesAgg[0]?.total ?? 0;

    const expensesByCategory: Array<{ category: string; label: string; amountPaise: number }> = [];
    const incomeByCategory: Array<{ category: string; label: string; amountPaise: number }> = [];
    for (const r of byCat) {
      const row = { category: r._id.category, label: CAT_LABEL[r._id.category] ?? r._id.category, amountPaise: r.total };
      (r._id.direction === "expense" ? expensesByCategory : incomeByCategory).push(row);
    }
    if (feesCollected > 0) incomeByCategory.unshift({ category: "fees_collected", label: CAT_LABEL.fees_collected ?? "Fees collected online", amountPaise: feesCollected });
    expensesByCategory.sort((a, b) => b.amountPaise - a.amountPaise);
    incomeByCategory.sort((a, b) => b.amountPaise - a.amountPaise);

    const totalExpense = expensesByCategory.reduce((s, r) => s + r.amountPaise, 0);
    const totalIncome = incomeByCategory.reduce((s, r) => s + r.amountPaise, 0);
    return { month: key, feesCollected, incomeByCategory, expensesByCategory, totalIncome, totalExpense, netPaise: totalIncome - totalExpense };
  }
}

function serialize(d: EntryDoc) {
  return {
    id: String(d._id), direction: d.direction, category: d.category, amountPaise: d.amountPaise,
    date: d.date instanceof Date ? d.date.toISOString() : d.date, note: d.note,
    payeeType: d.payeeType, coachUserId: d.coachUserId, payeeName: d.payeeName, recurring: d.recurring,
    createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
  };
}
