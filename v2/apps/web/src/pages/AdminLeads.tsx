import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { adminLeadActivity, adminLeadCreate, adminLeads, adminLeadsSummary, adminLeadUpdate, LEAD_STATUSES } from "../lib/api";
import type { Lead, LeadActivity, LeadStatus } from "../lib/api";

/* ── Superadmin sales pipeline (2026-09-13) ─────────────────────────────────────
 * One row per academy we want on ChessGuru, seeded from the mined Chennai list
 * (122 academies). The owner works the list from here: call, note, set the next
 * follow-up, move the status. "Converted" is the only status that counts as a
 * conversion; the summary shows the rate against the whole list.
 * ───────────────────────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", interested: "Interested", demo: "Demo done", trial: "On trial", converted: "Converted", lost: "Lost" };
const STATUS_TONE: Record<LeadStatus, string> = {
  new: "bg-slate-700 text-slate-100", contacted: "bg-sky-800 text-sky-100", interested: "bg-indigo-800 text-indigo-100",
  demo: "bg-violet-800 text-violet-100", trial: "bg-amber-700 text-amber-50", converted: "bg-emerald-700 text-emerald-50", lost: "bg-rose-900 text-rose-100",
};
const KINDS: LeadActivity["kind"][] = ["call", "whatsapp", "email", "visit", "note"];

function fmtDate(d?: string | null) { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtWhen(d?: string | null) { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : t.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function isDue(d?: string | null) { return !!d && new Date(d).getTime() <= Date.now(); }
function telHref(phones: string) { const m = phones.match(/\+?\d[\d ]{7,}\d/); return m ? `tel:${m[0].replace(/\s+/g, "")}` : undefined; }
function waHref(phones: string) { const m = phones.match(/\+?\d[\d ]{7,}\d/); if (!m) return undefined; let n = m[0].replace(/\D/g, ""); if (n.length === 10) n = "91" + n; return `https://wa.me/${n}`; }
function toDateInput(d?: string | null) { if (!d) return ""; const t = new Date(d); return isNaN(t.getTime()) ? "" : t.toISOString().slice(0, 10); }

export default function AdminLeadsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const summary = useQuery({ queryKey: ["admin-leads-summary"], queryFn: adminLeadsSummary });
  const leads = useQuery({ queryKey: ["admin-leads", status, q], queryFn: () => adminLeads({ status, q }), retry: false });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["admin-leads"] }); qc.invalidateQueries({ queryKey: ["admin-leads-summary"] }); };
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<Lead> }) => adminLeadUpdate(id, body), onSuccess: invalidate });
  const activity = useMutation({ mutationFn: ({ id, kind, text }: { id: string; kind: LeadActivity["kind"]; text: string }) => adminLeadActivity(id, { kind, text }), onSuccess: invalidate });
  const create = useMutation({ mutationFn: (body: Partial<Lead>) => adminLeadCreate(body), onSuccess: () => { setAdding(false); invalidate(); } });

  const rows = useMemo(() => {
    const all = leads.data ?? [];
    return dueOnly ? all.filter((l) => isDue(l.nextFollowUpAt) && l.status !== "converted" && l.status !== "lost") : all;
  }, [leads.data, dueOnly]);

  if (leads.isError) {
    const msg = String((leads.error as Error)?.message ?? "");
    return <div className="mx-auto max-w-3xl p-6 text-slate-200">{/401|login required/i.test(msg) ? <>Sign in first. <Link className="underline" to="/login">Login</Link></> : /403|admin only/i.test(msg) ? "Admin only." : `Could not load leads: ${msg}`}</div>;
  }
  const s = summary.data;

  return (
    <div className="mx-auto max-w-[1400px] p-4 text-slate-100">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Leads — academies to convert</h1>
          <p className="text-sm text-slate-400">Chennai chess academies mined on 13 Sep 2026. Call, note, set the next follow-up, move the status. Only <b>Converted</b> counts as a conversion.</p>
        </div>
        <div className="flex gap-2">
          <a className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800" href="/v2api/api/admin/leads/export.csv">Export CSV</a>
          <button className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600" onClick={() => setAdding(true)}>+ Add academy</button>
        </div>
      </div>

      {s && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
          <Stat label="Total" value={s.total} onClick={() => setStatus("")} active={status === ""} />
          {LEAD_STATUSES.map((st) => <Stat key={st} label={STATUS_LABEL[st]} value={s.byStatus[st] ?? 0} onClick={() => setStatus(st)} active={status === st} tone={STATUS_TONE[st]} />)}
          <Stat label="Conversion" value={`${s.conversionPct}%`} sub={`${s.followUpsDue} follow-ups due`} onClick={() => setDueOnly((v) => !v)} active={dueOnly} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search academy, locality, phone, coach, note…" className="w-80 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-emerald-500" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-300"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> follow-up due</label>
        <span className="text-xs text-slate-500">{rows.length} shown{leads.isFetching ? " · refreshing…" : ""}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="p-2">Academy</th><th className="p-2">Locality</th><th className="p-2">Contact</th><th className="p-2">Coaches</th>
              <th className="p-2">Size (est.)</th><th className="p-2">Status</th><th className="p-2">Next follow-up</th><th className="p-2">Last touch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <LeadRow key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)}
                onStatus={(st) => update.mutate({ id: l.id, body: { status: st } })}
                onFollowUp={(d) => update.mutate({ id: l.id, body: { nextFollowUpAt: d ? new Date(d + "T09:00:00+05:30").toISOString() : null } as Partial<Lead> })}
                onSave={(body) => update.mutate({ id: l.id, body })}
                onActivity={(kind, text) => activity.mutate({ id: l.id, kind, text })} />
            ))}
            {rows.length === 0 && !leads.isLoading && <tr><td className="p-4 text-slate-400" colSpan={8}>No leads match.</td></tr>}
          </tbody>
        </table>
      </div>

      {adding && <AddLead onClose={() => setAdding(false)} onSave={(b) => create.mutate(b)} busy={create.isPending} />}
    </div>
  );
}

function Stat({ label, value, sub, onClick, active, tone }: { label: string; value: string | number; sub?: string; onClick?: () => void; active?: boolean; tone?: string }) {
  return (
    <button onClick={onClick} className={`rounded-xl border p-2 text-left ${active ? "border-emerald-500" : "border-slate-700"} bg-slate-900 hover:border-slate-500`}>
      <div className={`inline-block rounded px-1.5 text-[11px] font-semibold ${tone ?? "bg-slate-800 text-slate-300"}`}>{label}</div>
      <div className="text-xl font-black">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </button>
  );
}

function LeadRow({ lead: l, open, onToggle, onStatus, onFollowUp, onSave, onActivity }: {
  lead: Lead; open: boolean; onToggle: () => void; onStatus: (s: LeadStatus) => void; onFollowUp: (d: string) => void;
  onSave: (b: Partial<Lead>) => void; onActivity: (kind: LeadActivity["kind"], text: string) => void;
}) {
  const [kind, setKind] = useState<LeadActivity["kind"]>("call");
  const [text, setText] = useState("");
  const [edit, setEdit] = useState<Partial<Lead> | null>(null);
  const due = isDue(l.nextFollowUpAt) && l.status !== "converted" && l.status !== "lost";
  const lastNote = [...(l.activity ?? [])].reverse().find((a) => a.kind !== "status");
  return (
    <>
      <tr className={`border-t border-slate-800 align-top hover:bg-slate-900/60 ${open ? "bg-slate-900/80" : ""}`}>
        <td className="p-2">
          <button className="text-left font-semibold hover:underline" onClick={onToggle}>{l.name}</button>
          {l.website && <div className="text-[11px] text-slate-400 truncate max-w-[220px]"><a className="hover:underline" href={/^https?:/.test(l.website) ? l.website : `https://${(l.website.split(";")[0] ?? "").trim()}`} target="_blank" rel="noreferrer">{l.website.split(";")[0] ?? ""}</a></div>}
        </td>
        <td className="p-2 text-slate-300 max-w-[200px]">{l.locality || "—"}</td>
        <td className="p-2">
          {l.phones ? <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-200">{l.phones}</span>
            {telHref(l.phones) && <a className="rounded bg-slate-800 px-1.5 text-[11px] hover:bg-slate-700" href={telHref(l.phones)}>call</a>}
            {waHref(l.phones) && <a className="rounded bg-emerald-900 px-1.5 text-[11px] hover:bg-emerald-800" href={waHref(l.phones)} target="_blank" rel="noreferrer">WhatsApp</a>}
          </div> : <span className="text-slate-500">no phone published</span>}
          {l.email && <div className="text-[12px]"><a className="text-sky-300 hover:underline" href={`mailto:${(l.email.split(";")[0] ?? "").trim()}`}>{l.email}</a></div>}
        </td>
        <td className="p-2 text-slate-300 max-w-[260px]">{l.coaches || <span className="text-slate-500">—</span>}</td>
        <td className="p-2 text-slate-300 whitespace-nowrap">
          <div>{l.estStudents || "—"} students</div>
          <div className="text-[11px] text-slate-400">{l.estCoaches || "—"} coaches · {l.estimateBasis || "estimated"}</div>
        </td>
        <td className="p-2">
          <select value={l.status} onChange={(e) => onStatus(e.target.value as LeadStatus)} className={`rounded px-1.5 py-1 text-xs font-semibold ${STATUS_TONE[l.status]}`}>
            {LEAD_STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </td>
        <td className="p-2">
          <input type="date" value={toDateInput(l.nextFollowUpAt)} onChange={(e) => onFollowUp(e.target.value)} className={`rounded border bg-slate-900 px-1.5 py-1 text-xs ${due ? "border-rose-500 text-rose-200" : "border-slate-700"}`} />
        </td>
        <td className="p-2 text-[12px] text-slate-400 max-w-[220px]">
          <div>{fmtWhen(l.lastContactAt)}</div>
          {lastNote && <div className="truncate" title={lastNote.text}>{lastNote.kind}: {lastNote.text}</div>}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-800 bg-slate-950/60">
          <td colSpan={8} className="p-3">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="text-sm">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Details</div>
                {edit ? (
                  <div className="grid gap-1">
                    {(["name", "locality", "address", "phones", "email", "website", "coaches", "estStudents", "estCoaches", "assignee", "notes"] as const).map((k) => (
                      <label key={k} className="grid grid-cols-[110px_1fr] items-center gap-2 text-xs"><span className="text-slate-400">{k}</span>
                        <input value={String(edit[k] ?? "")} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} className="rounded border border-slate-700 bg-slate-900 px-2 py-1" /></label>
                    ))}
                    <div className="mt-1 flex gap-2">
                      <button className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold" onClick={() => { onSave(edit); setEdit(null); }}>Save</button>
                      <button className="rounded border border-slate-600 px-3 py-1 text-xs" onClick={() => setEdit(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5 text-slate-300">
                    <div><span className="text-slate-500">Address: </span>{l.address || "—"}</div>
                    <div><span className="text-slate-500">Website: </span>{l.website || "—"}</div>
                    <div><span className="text-slate-500">Assignee: </span>{l.assignee || "—"}</div>
                    <div><span className="text-slate-500">Notes: </span>{l.notes || "—"}</div>
                    <div><span className="text-slate-500">Sources: </span>{l.sources || "—"}</div>
                    <div><span className="text-slate-500">Converted academy id: </span>{l.academyId || "—"}</div>
                    <button className="mt-1 rounded border border-slate-600 px-2 py-0.5 text-xs" onClick={() => setEdit({ name: l.name, locality: l.locality, address: l.address, phones: l.phones, email: l.email, website: l.website, coaches: l.coaches, estStudents: l.estStudents, estCoaches: l.estCoaches, assignee: l.assignee, notes: l.notes })}>Edit</button>
                  </div>
                )}
              </div>
              <div className="lg:col-span-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Follow-up log</div>
                <div className="mb-2 flex gap-2">
                  <select value={kind} onChange={(e) => setKind(e.target.value as LeadActivity["kind"])} className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs">
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onActivity(kind, text.trim()); setText(""); } }}
                    placeholder="What happened on the call / what they said / what's next…" className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm" />
                  <button className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold" onClick={() => { if (text.trim()) { onActivity(kind, text.trim()); setText(""); } }}>Add</button>
                </div>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-[13px]">
                  {[...(l.activity ?? [])].reverse().map((a, i) => (
                    <li key={i} className="flex gap-2 text-slate-300"><span className="w-28 shrink-0 text-slate-500">{fmtWhen(a.at)}</span><span className="w-16 shrink-0 text-slate-400">{a.kind}</span><span>{a.text}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddLead({ onClose, onSave, busy }: { onClose: () => void; onSave: (b: Partial<Lead>) => void; busy: boolean }) {
  const [b, setB] = useState<Partial<Lead>>({ name: "", city: "Chennai", locality: "", phones: "", email: "", website: "", coaches: "", notes: "" });
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-4 text-slate-100 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-lg font-black">Add an academy</div>
        <div className="grid gap-1">
          {(["name", "city", "locality", "phones", "email", "website", "coaches", "notes"] as const).map((k) => (
            <label key={k} className="grid grid-cols-[90px_1fr] items-center gap-2 text-xs"><span className="text-slate-400">{k}</span>
              <input value={String(b[k] ?? "")} onChange={(e) => setB({ ...b, [k]: e.target.value })} className="rounded border border-slate-700 bg-slate-950 px-2 py-1" /></label>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded border border-slate-600 px-3 py-1.5 text-sm" onClick={onClose}>Cancel</button>
          <button disabled={busy || !String(b.name ?? "").trim()} className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold disabled:opacity-50" onClick={() => onSave(b)}>Save</button>
        </div>
      </div>
    </div>
  );
}
