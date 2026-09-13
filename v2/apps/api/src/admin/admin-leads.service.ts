import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ObjectId } from "mongodb";

/** Superadmin sales pipeline (2026-09-13): the academies we want on ChessGuru, one row each,
 *  with the contact details mined from their websites and directories and the owner's own
 *  follow-up trail. Seeded with 122 Chennai academies; the owner works the list from
 *  /admin/leads and marks each one as it moves towards a conversion. */
export type LeadStatus = "new" | "contacted" | "interested" | "demo" | "trial" | "converted" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "interested", "demo", "trial", "converted", "lost"];

export type LeadActivity = { at: Date; by: string; kind: "note" | "call" | "status" | "email" | "whatsapp" | "visit"; text: string };
export type LeadDoc = {
  _id: ObjectId;
  name: string; city: string; locality: string; address: string;
  phones: string; email: string; website: string; coaches: string;
  estStudents: string; estCoaches: string; estimateBasis: string;
  notes: string; sources: string;
  status: LeadStatus; assignee: string; nextFollowUpAt: Date | null; lastContactAt: Date | null;
  academyId: string | null;                 // set when the academy signs up — the conversion
  optIn: boolean;                            // the academy agreed to receive WhatsApp/marketing — REQUIRED before any Meta API template send
  optInAt: Date | null;                      // when they agreed (proof for consent + DPDP)
  optInSource: string;                       // how: 'said yes on call', 'web form', 'reply on WhatsApp'…
  activity: LeadActivity[];
  createdAt: Date; updatedAt: Date;
};

const EDITABLE = ["name", "city", "locality", "address", "phones", "email", "website", "coaches", "estStudents", "estCoaches", "estimateBasis", "notes", "sources", "assignee", "academyId", "optInSource"] as const;

@Injectable()
export class AdminLeadsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}
  private col() { return this.conn.db!.collection<LeadDoc>("academyLeads"); }

  async list(q: { status?: string; search?: string; city?: string }) {
    const filter: Record<string, unknown> = {};
    if (q.status && LEAD_STATUSES.includes(q.status as LeadStatus)) filter.status = q.status;
    if (q.city) filter.city = q.city;
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { locality: rx }, { phones: rx }, { email: rx }, { coaches: rx }, { notes: rx }];
    }
    const rows = await this.col().find(filter).sort({ status: 1, name: 1 }).toArray();
    return rows.map(serialize);
  }

  async summary() {
    const agg = await this.col().aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
    const byStatus: Record<string, number> = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    for (const a of agg) byStatus[a._id] = a.n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const due = await this.col().countDocuments({ nextFollowUpAt: { $ne: null, $lte: new Date() }, status: { $nin: ["converted", "lost"] } });
    return { total, byStatus, followUpsDue: due, converted: byStatus.converted ?? 0, conversionPct: total ? Math.round(((byStatus.converted ?? 0) / total) * 1000) / 10 : 0 };
  }

  async get(id: string) {
    const d = await this.col().findOne({ _id: new ObjectId(id) });
    return d ? serialize(d) : null;
  }

  /** Upsert by case-insensitive name + city: re-running an import refreshes the mined columns and
   *  never touches the owner's status, notes or activity. */
  async importRows(rows: Array<Record<string, string>>, by: string) {
    let inserted = 0, updated = 0;
    const now = new Date();
    for (const r of rows) {
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      const city = String(r.city ?? "Chennai").trim() || "Chennai";
      const mined = {
        locality: str(r.locality), address: str(r.address), phones: str(r.phones), email: str(r.email), website: str(r.website),
        coaches: str(r.coaches), estStudents: str(r.estStudents), estCoaches: str(r.estCoaches), estimateBasis: str(r.estimateBasis),
        sources: str(r.sources),
      };
      const existing = await this.col().findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), city });
      if (existing) {
        await this.col().updateOne({ _id: existing._id }, { $set: { ...mined, updatedAt: now } });
        updated += 1;
      } else {
        await this.col().insertOne({
          _id: new ObjectId(), name, city, ...mined, notes: str(r.notes), status: "new", assignee: "", nextFollowUpAt: null, lastContactAt: null,
          academyId: null, optIn: false, optInAt: null, optInSource: "", activity: [{ at: now, by, kind: "note", text: "Imported from the mined list" }], createdAt: now, updatedAt: now,
        });
        inserted += 1;
      }
    }
    return { inserted, updated };
  }

  async create(body: Record<string, unknown>, by: string) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new Error("name required");
    const now = new Date();
    const doc: LeadDoc = {
      _id: new ObjectId(), name, city: str(body.city) || "Chennai", locality: str(body.locality), address: str(body.address), phones: str(body.phones),
      email: str(body.email), website: str(body.website), coaches: str(body.coaches), estStudents: str(body.estStudents), estCoaches: str(body.estCoaches),
      estimateBasis: str(body.estimateBasis), notes: str(body.notes), sources: str(body.sources) || "added by hand", status: "new", assignee: "",
      nextFollowUpAt: null, lastContactAt: null, academyId: null, optIn: false, optInAt: null, optInSource: "", activity: [{ at: now, by, kind: "note", text: "Added by hand" }], createdAt: now, updatedAt: now,
    };
    await this.col().insertOne(doc);
    return serialize(doc);
  }

  async update(id: string, body: Record<string, unknown>, by: string) {
    const _id = new ObjectId(id);
    const cur = await this.col().findOne({ _id });
    if (!cur) return null;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const pushes: LeadActivity[] = [];
    for (const k of EDITABLE) if (k in body) set[k] = str(body[k]);
    if ("nextFollowUpAt" in body) set.nextFollowUpAt = body.nextFollowUpAt ? new Date(String(body.nextFollowUpAt)) : null;
    if ("optIn" in body) {
      const want = !!body.optIn;
      if (want !== cur.optIn) {
        set.optIn = want;
        set.optInAt = want ? new Date() : null;
        if (want && typeof body.optInSource === "string") set.optInSource = str(body.optInSource);
        if (!want) set.optInSource = "";
        pushes.push({ at: new Date(), by, kind: "note", text: want ? `Opted IN to WhatsApp${body.optInSource ? ` (${str(body.optInSource)})` : ""}` : "Opt-in withdrawn" });
      }
    }
    if ("status" in body) {
      const s = String(body.status) as LeadStatus;
      if (!LEAD_STATUSES.includes(s)) throw new Error("bad status");
      if (s !== cur.status) {
        set.status = s;
        set.lastContactAt = new Date();
        pushes.push({ at: new Date(), by, kind: "status", text: `${cur.status} → ${s}` });
      }
    }
    await this.col().updateOne({ _id }, pushes.length ? { $set: set, $push: { activity: { $each: pushes } } } : { $set: set });
    return this.get(id);
  }

  async addActivity(id: string, body: { kind?: string; text?: string }, by: string) {
    const _id = new ObjectId(id);
    const kind = (["note", "call", "status", "email", "whatsapp", "visit"].includes(String(body.kind)) ? body.kind : "note") as LeadActivity["kind"];
    const text = String(body.text ?? "").trim();
    if (!text) throw new Error("text required");
    const now = new Date();
    await this.col().updateOne({ _id }, { $push: { activity: { at: now, by, kind, text } }, $set: { lastContactAt: now, updatedAt: now } });
    return this.get(id);
  }

  async exportCsv() {
    const rows = await this.col().find({}).sort({ name: 1 }).toArray();
    const cols = ["name", "city", "locality", "address", "phones", "email", "website", "coaches", "estStudents", "estCoaches", "estimateBasis", "status", "assignee", "optIn", "optInAt", "optInSource", "nextFollowUpAt", "lastContactAt", "notes", "sources"];
    const esc = (v: unknown) => { const s = v instanceof Date ? v.toISOString() : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(","))].join("\n");
  }
}

const str = (v: unknown) => (v == null ? "" : String(v).trim());
function serialize(d: LeadDoc) {
  return { ...d, id: String(d._id), _id: undefined,
    nextFollowUpAt: d.nextFollowUpAt ? d.nextFollowUpAt.toISOString() : null, lastContactAt: d.lastContactAt ? d.lastContactAt.toISOString() : null,
    optInAt: d.optInAt ? d.optInAt.toISOString() : null,
    createdAt: d.createdAt?.toISOString?.() ?? null, updatedAt: d.updatedAt?.toISOString?.() ?? null,
    activity: (d.activity ?? []).map((a) => ({ ...a, at: a.at instanceof Date ? a.at.toISOString() : a.at })) };
}
