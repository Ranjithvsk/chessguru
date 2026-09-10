// Super-admin: the vision engines — what is running, when it last changed, what is flowing
// through it, and the review queue that feeds the next retrain (owner request, 2026-09-10).
//
// The one idea on this page: recognition only improves when corrections reach the training set.
// Corrections the model was UNSURE about are approved automatically. Corrections the model was
// CONFIDENT about are held here for a human, because the coach might be the one who is wrong.
// Approving them is how "95%" moves. Everything else on the page is there to tell you whether
// that loop is alive.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api, get, post } from "../lib/api";

type Status = {
  at: string;
  days: string[];
  service: { ok: boolean; ms: number; board_extractor?: string; classifier?: string; error?: string };
  models: { files: Array<{ key: string; label: string; path: string; engine: string; present: boolean; bytes: number; mtime: string | null }>; changedByLastRetrain: boolean };
  scans: { ok: boolean; byDay: Record<string, number>; byTag: Record<string, number>; totalFiles: number; error?: string };
  corrections: { byDay: Record<string, number>; autoApprovedByDay: Record<string, number>; total: number; lastAt: string | null };
  cornerLabels: { byDay: Record<string, number>; total: number; lastAt: string | null };
  retrain: { ok: boolean; runs: Array<{ valAcc: number | null; note: string; startedAt?: string | null }>; lastLines: string[]; lastClassCounts: Record<string, number>; error?: string };
  trainingSet: { byClass: Record<string, { correction: number; seed: number }>; total: number; unapproved: number };
  pendingReview: number;
};
type Win = { scanned: number; edited: number; acceptedAsRead: number; confirmed: number; correctPct: number | null; squaresCorrected: number; squareAccuracyPct: number | null; avgConfPct: number | null; weakSquaresPerScan: number | null; scanners: number };
type Analytics = {
  since: string | null; all: Win; last30: Win; last7: Win;
  confusion: Array<{ modelSaid: string; coachSaid: string; n: number }>;
  books: { reachable: boolean; total?: number; done?: number; inProgress?: number; pages?: number; pagesDone?: number; diagrams?: number; error?: string };
  readerFixes: { books: number; diagrams: number; corrected: number; disputed: number; events: number };
  legacy: { seedingCorrections: number; scanImagesOnDisk: number; note: string };
  benchmark: { size: number; runs: Array<{ at: string; n: number; positionAccPct: number | null; squareAccPct: number | null; model?: string | null }> };
  perBook: Array<{ book: string; diagrams: number; avgConfPct: number | null; corrected: number; disputed: number; correctedPct: number | null; events: number }>;
};
type Settings = { autoApproveBelow: number; reviewed: number; approvedByHuman: number; rejectedByHuman: number; humanApprovalPct: number | null; lastStallMailAt: string | null };
type ReviewRow = { id: string; piece: string; color: string; setName: string | null; modelConf: number | null; modelPiece: string | null; modelColor: string | null; by: string | null; at: string | null; thumb: string | null };

const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const PIECE_NAME: Record<string, string> = { P: "pawn", N: "knight", B: "bishop", R: "rook", Q: "queen", K: "king" };
const pieceLabel = (color: string | null, piece: string | null) => piece ? `${color === "b" ? "black" : "white"} ${PIECE_NAME[piece] ?? piece}` : "empty";

function Bars({ days, series, colors }: { days: string[]; series: Array<{ label: string; byDay: Record<string, number> }>; colors: string[] }) {
  const max = Math.max(1, ...series.flatMap((s) => days.map((d) => s.byDay[d] ?? 0)));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {days.map((d) => (
          <div key={d} className="flex flex-1 items-end justify-center gap-px" title={`${d}: ${series.map((s) => `${s.label} ${s.byDay[d] ?? 0}`).join(" · ")}`}>
            {series.map((s, i) => (
              <div key={s.label} className={`w-full rounded-t ${colors[i]}`} style={{ height: `${Math.round(((s.byDay[d] ?? 0) / max) * 96)}px`, minHeight: (s.byDay[d] ?? 0) > 0 ? 3 : 0 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500"><span>{days[0]?.slice(5)}</span><span>{days[days.length - 1]?.slice(5)}</span></div>
      <div className="mt-1 flex gap-3 text-xs text-ink-400">{series.map((s, i) => <span key={s.label}><span className={`mr-1 inline-block h-2 w-2 rounded-sm ${colors[i]}`} />{s.label}</span>)}</div>
    </div>
  );
}

function Card({ title, children, tone = "" }: { title: string; children: ReactNode; tone?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60 p-4 ${tone}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminVisionPage() {
  const qc = useQueryClient();
  const { data: auth, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-vision-status"], queryFn: () => get<Status>("/api/admin/vision/status"), refetchInterval: 60_000 });
  const { data: review } = useQuery({ queryKey: ["admin-vision-review"], queryFn: () => get<{ rows: ReviewRow[] }>("/api/admin/vision/review?limit=60"), refetchInterval: 60_000 });
  const { data: an } = useQuery({ queryKey: ["admin-vision-analytics"], queryFn: () => get<Analytics>("/api/admin/vision/analytics"), refetchInterval: 60_000 });
  const { data: st } = useQuery({ queryKey: ["admin-vision-settings"], queryFn: () => get<Settings>("/api/admin/vision/settings") });
  const [threshold, setThreshold] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const saveThreshold = async () => {
    const v = Number(threshold); if (!Number.isFinite(v) || v < 0 || v > 1) return;
    setBusy("threshold");
    try { await post("/api/admin/vision/settings", { autoApproveBelow: v }); setThreshold(""); }
    finally { setBusy(null); void qc.invalidateQueries({ queryKey: ["admin-vision-settings"] }); }
  };

  if (authLoading) return <div className="p-6 text-ink-400">Loading…</div>;
  if (auth && !auth.loggedIn) return <Navigate to="/login" replace />;
  if (error) return <div className="p-6 text-rose-300">{String((error as Error).message || error)}</div>;
  if (isLoading || !data) return <div className="p-6 text-ink-400">Reading the engines…</div>;

  const decide = async (id: string, verdict: "approve" | "reject") => {
    setBusy(id);
    try { await post(`/api/admin/vision/review/${id}/${verdict}`, {}); }
    finally { setBusy(null); void qc.invalidateQueries({ queryKey: ["admin-vision-review"] }); void qc.invalidateQueries({ queryKey: ["admin-vision-status"] }); }
  };

  const s = data;
  const scansToday = s.scans.byDay[s.days[s.days.length - 1] ?? ""] ?? 0;
  const scans14 = s.days.reduce((a, d) => a + (s.scans.byDay[d] ?? 0), 0);
  const corr14 = s.days.reduce((a, d) => a + (s.corrections.byDay[d] ?? 0), 0);
  const lastRun = [...s.retrain.runs].reverse().find((r) => r.valAcc != null);
  const apiModel = s.models.files.find((f) => f.key === "api-onnx");
  const loopAlive = corr14 > 0;

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-5 overflow-x-hidden p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">👁 Vision engines</h1>
          <p className="text-sm text-ink-400">Board and piece recognition: health, training data, and the review queue that improves it. Refreshes every minute.</p>
        </div>
        <div className="text-xs text-ink-500">as of {new Date(s.at).toLocaleTimeString()}</div>
      </header>

      {/* The verdict, first. */}
      <div className={`rounded-xl border p-4 ${loopAlive ? "border-emerald-700 bg-emerald-950/40" : "border-amber-700 bg-amber-950/40"}`}>
        <div className="text-base font-semibold text-white">
          {loopAlive
            ? `The improvement loop is alive: ${corr14} corrections in 14 days, ${s.pendingReview} waiting for your review.`
            : `The improvement loop is idle: no corrections have reached the training set in 14 days.`}
        </div>
        <div className="mt-1 break-words text-sm text-ink-300">
          Last correction {ago(s.corrections.lastAt)} · last retrain result {lastRun ? `${lastRun.valAcc}% val` : "none in log"} ·
          served model {apiModel?.present ? `${ago(apiModel.mtime)}${s.models.changedByLastRetrain ? ", changed by the last retrain" : ", NOT changed by the last retrain"}` : "missing"}
        </div>
      </div>

      {an && (
        <Card title="Analytics — positions and books">
          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            {([["Last 7 days", an.last7], ["Last 30 days", an.last30], ["Since records began", an.all]] as Array<[string, Win]>).map(([label, w]) => (
              <div key={label} className="min-w-0 rounded-lg border border-ink-800 bg-ink-950 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{w.scanned} <span className="text-sm font-normal text-ink-400">positions scanned</span></div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <div className="text-ink-400">correct as read</div><div className="text-right tabular-nums text-emerald-300">{w.acceptedAsRead}{w.correctPct != null && <span className="text-ink-500"> · {w.correctPct}%</span>}</div>
                  <div className="text-ink-400">confirmed by a coach</div><div className="text-right tabular-nums text-emerald-200">{w.confirmed}</div>
                  <div className="text-ink-400">edited by a coach</div><div className="text-right tabular-nums text-amber-300">{w.edited}</div>
                  <div className="text-ink-400">squares corrected</div><div className="text-right tabular-nums text-ink-200">{w.squaresCorrected}</div>
                  <div className="text-ink-400">square accuracy</div><div className="text-right tabular-nums text-white">{w.squareAccuracyPct != null ? `${w.squareAccuracyPct}%` : "—"}</div>
                  <div className="text-ink-400">avg confidence</div><div className="text-right tabular-nums text-ink-200">{w.avgConfPct != null ? `${w.avgConfPct}%` : "—"}</div>
                  <div className="text-ink-400">weak squares / scan</div><div className="text-right tabular-nums text-ink-200">{w.weakSquaresPerScan ?? "—"}</div>
                  <div className="text-ink-400">people scanning</div><div className="text-right tabular-nums text-ink-200">{w.scanners}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 break-words text-xs text-ink-500">
            Records begin {an.since ? new Date(an.since).toLocaleString() : "with the next scan"}. A position counts as correct when nobody changed a square after scanning it.
            {" "}{an.legacy.note} ({an.legacy.seedingCorrections} such corrections, {an.legacy.scanImagesOnDisk} scan images on disk.)
          </p>
          <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-ink-800 bg-ink-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Books scanned</div>
              {an.books.reachable ? (
                <>
                  <div className="mt-1 text-2xl font-semibold text-white">{an.books.total} <span className="text-sm font-normal text-ink-400">books · {an.books.done} finished · {an.books.inProgress} in progress</span></div>
                  <div className="mt-1 text-sm text-ink-300">{an.books.pages?.toLocaleString()} pages · {an.books.diagrams?.toLocaleString()} diagrams extracted</div>
                </>
              ) : <div className="mt-1 break-all text-sm text-rose-300">Book host unreachable{an.books.error ? `: ${an.books.error}` : ""}. It runs on the laptop; if it is asleep, this is why.</div>}
              <div className="mt-2 text-xs text-ink-400">Read here: {an.readerFixes.books} books · {an.readerFixes.diagrams} diagrams · {an.readerFixes.corrected} corrected by readers · {an.readerFixes.disputed} disputed · {an.readerFixes.events} correction events</div>
            </div>
            <div className="min-w-0 rounded-lg border border-ink-800 bg-ink-950 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">What the model confuses</div>
              {an.confusion.length ? (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {an.confusion.map((c, i) => <li key={i} className="flex justify-between"><span className="text-ink-300">said <span className="text-ink-100">{c.modelSaid}</span>, coach said <span className="text-white">{c.coachSaid}</span></span><span className="tabular-nums text-amber-300">{c.n}×</span></li>)}
                </ul>
              ) : <div className="mt-1 text-sm text-ink-500">No corrections with a recorded model guess yet.</div>}
            </div>
          </div>
        </Card>
      )}

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <Card title="Service" tone={s.service.ok ? "" : "border-rose-700"}>
          <div className={`text-lg font-semibold ${s.service.ok ? "text-emerald-300" : "text-rose-300"}`}>{s.service.ok ? "Online" : "Down"} <span className="text-sm font-normal text-ink-400">{s.service.ms} ms</span></div>
          <div className="mt-1 text-sm text-ink-300">extractor: {s.service.board_extractor ?? "?"} · classifier: {s.service.classifier ?? "?"}</div>
          {s.service.error && <div className="mt-1 break-all text-xs text-rose-300">{s.service.error}</div>}
        </Card>
        <Card title="Scans">
          <div className="text-lg font-semibold text-white">{scansToday} <span className="text-sm font-normal text-ink-400">today</span> · {scans14} <span className="text-sm font-normal text-ink-400">in 14 days</span></div>
          <div className="mt-1 break-words text-xs text-ink-400">{s.scans.totalFiles} images on disk · {Object.entries(s.scans.byTag).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n}`).join(" · ")}</div>
          {!s.scans.ok && <div className="mt-1 break-all text-xs text-rose-300">{s.scans.error}</div>}
        </Card>
        <Card title="Training set">
          <div className="text-lg font-semibold text-white">{s.trainingSet.total} <span className="text-sm font-normal text-ink-400">approved samples</span></div>
          <div className="mt-1 text-sm text-ink-300">{s.trainingSet.unapproved} unapproved · {s.cornerLabels.total} corner labels (last {ago(s.cornerLabels.lastAt)})</div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card title="Scans and corrections, last 14 days">
          <Bars days={s.days} series={[{ label: "scans", byDay: s.scans.byDay }, { label: "corrections", byDay: s.corrections.byDay }, { label: "auto-approved", byDay: s.corrections.autoApprovedByDay }]} colors={["bg-sky-500", "bg-amber-400", "bg-emerald-500"]} />
          <p className="mt-2 text-xs text-ink-400">A correction is one square a coach changed after a scan. Scans with no corrections were accepted as read.</p>
        </Card>
        <Card title="Nightly retrain">
          {s.retrain.ok ? (
            <>
              <div className="flex max-w-full flex-wrap gap-1">
                {s.retrain.runs.map((r, i) => (
                  <span key={i} title={`${r.startedAt ? r.startedAt.slice(0, 10) + " · " : ""}${r.note}`} className={`rounded px-2 py-0.5 text-xs ${r.valAcc == null ? "bg-rose-900 text-rose-200" : "bg-ink-800 text-ink-200"}`}>{r.valAcc == null ? "✗" : `${r.valAcc}%`}</span>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-400">Validation accuracy per run, oldest to newest. A flat line means the training set did not change between runs.</p>
              <pre className="mt-2 max-h-32 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-ink-950 p-2 text-[11px] text-ink-300">{s.retrain.lastLines.join("\n")}</pre>
            </>
          ) : <div className="break-all text-sm text-rose-300">Retrain log unreadable: {s.retrain.error}</div>}
        </Card>
      </div>

      <Card title="Model weights">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-500"><tr><th className="py-1">Model</th><th>Engine</th><th>Size</th><th>Last changed</th></tr></thead>
            <tbody>
              {s.models.files.map((f) => (
                <tr key={f.key} className="border-t border-ink-800">
                  <td className="break-words py-1.5 text-white">{f.label}{!f.present && <span className="ml-2 rounded bg-rose-900 px-1.5 text-xs text-rose-200">missing</span>}</td>
                  <td className="text-ink-300">{f.engine}</td>
                  <td className="tabular-nums text-ink-300">{f.present ? mb(f.bytes) : "—"}</td>
                  <td className="text-ink-300" title={f.mtime ?? ""}>{f.present ? ago(f.mtime) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Approved samples by class">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
          {["wK","wQ","wR","wB","wN","wP","bK","bQ","bR","bB","bN","bP"].map((k) => {
            const c = s.trainingSet.byClass[k] ?? { correction: 0, seed: 0 };
            const n = c.correction + c.seed;
            return <div key={k} className="flex justify-between border-b border-ink-800/60 py-0.5"><span className="text-ink-300">{pieceLabel(k[0] ?? "w", k[1] ?? "")}</span><span className={`tabular-nums ${n < 10 ? "text-amber-300" : "text-white"}`}>{n}<span className="text-ink-500"> ({c.correction} real)</span></span></div>;
          })}
        </div>
        <p className="mt-2 text-xs text-ink-400">Amber means fewer than ten samples. Those classes are where the model will keep guessing.</p>
      </Card>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card title="Auto-approve threshold">
          {st ? (
            <>
              <p className="text-sm text-ink-300">A correction is trained on automatically when the model's own confidence was below <span className="font-semibold text-white">{st.autoApproveBelow}</span>. Above it, the correction waits in the queue for you.</p>
              <p className="mt-2 text-sm text-ink-300">Your reviews so far: <span className="text-white">{st.reviewed}</span> · approved {st.approvedByHuman} · rejected {st.rejectedByHuman}{st.humanApprovalPct != null && <span> · <span className="font-semibold text-emerald-300">{st.humanApprovalPct}%</span> approved</span>}</p>
              <p className="mt-1 text-xs text-ink-500">When that percentage stays high for a month, raise the threshold and the queue becomes an exception list. If coaches turn out to be wrong often, lower it.</p>
              <div className="mt-3 flex items-center gap-2">
                <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={String(st.autoApproveBelow)} inputMode="decimal" className="w-24 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-white" />
                <button onClick={() => void saveThreshold()} disabled={busy === "threshold" || !threshold} className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">Set</button>
              </div>
              {st.lastStallMailAt && <p className="mt-2 text-xs text-amber-300">Stall alert last sent {ago(st.lastStallMailAt)}.</p>}
            </>
          ) : <div className="text-sm text-ink-500">Loading…</div>}
        </Card>
        <Card title={`Held-out benchmark — ${an?.benchmark.size ?? 0} verified diagrams`}>
          {an?.benchmark.runs.length ? (
            <>
              <div className="flex flex-wrap gap-1">
                {an.benchmark.runs.map((r, i) => <span key={i} title={`${new Date(r.at).toLocaleString()} · ${r.n} diagrams · squares ${r.squareAccPct}%`} className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-200">{r.positionAccPct != null ? `${r.positionAccPct}%` : "—"}</span>)}
              </div>
              <p className="mt-2 text-xs text-ink-400">Whole-position accuracy per nightly run on diagrams the model never trains on, oldest to newest. Latest: {an.benchmark.runs[an.benchmark.runs.length - 1]?.positionAccPct ?? "—"}% positions, {an.benchmark.runs[an.benchmark.runs.length - 1]?.squareAccPct ?? "—"}% squares.</p>
            </>
          ) : <p className="text-sm text-ink-500">No run yet. The benchmark scores after each nightly retrain; seeded from reader-verified book diagrams and it grows with every correction you approve.</p>}
        </Card>
      </div>

      {an && an.perBook.length > 0 && (
        <Card title="Accuracy by book (books served from this server)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-ink-500"><tr><th className="py-1">Book</th><th>Diagrams</th><th>Avg conf</th><th>Reader-corrected</th><th>Disputed</th></tr></thead>
              <tbody>
                {an.perBook.map((b) => (
                  <tr key={b.book} className="border-t border-ink-800">
                    <td className="break-all py-1.5 text-white">{b.book}</td>
                    <td className="tabular-nums text-ink-300">{b.diagrams}</td>
                    <td className="tabular-nums text-ink-300">{b.avgConfPct != null ? `${b.avgConfPct}%` : "—"}</td>
                    <td className={`tabular-nums ${(b.correctedPct ?? 0) > 5 ? "text-amber-300" : "text-ink-300"}`}>{b.corrected}{b.correctedPct != null && <span className="text-ink-500"> · {b.correctedPct}%</span>}</td>
                    <td className="tabular-nums text-ink-300">{b.disputed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-400">A high corrected share on one book usually means one typeface the model has not seen enough of. That is the book to feed the training set from.</p>
        </Card>
      )}

      <Card title={`Review queue — ${s.pendingReview} corrections the model was confident about`}>
        <p className="mb-3 text-sm text-ink-300">
          Each tile is a square a coach corrected while the model was at least 90% sure of its own read. Approve if the coach is right and it joins tonight's training set. Reject if the coach mis-clicked.
        </p>
        {!review?.rows.length ? (
          <div className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-ink-500">Nothing waiting. Every confident correction has been reviewed.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {review.rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-ink-800 bg-ink-950 p-2">
                {r.thumb ? <img src={r.thumb} alt="" className="mx-auto h-20 w-20 rounded object-contain" style={{ imageRendering: "pixelated" }} /> : <div className="mx-auto flex h-20 w-20 items-center justify-center rounded bg-ink-900 text-xs text-ink-600">no image</div>}
                <div className="mt-2 text-xs text-ink-400">model said <span className="text-ink-200">{pieceLabel(r.modelColor, r.modelPiece)}</span>{r.modelConf != null && <span> ({Math.round(r.modelConf * 100)}%)</span>}</div>
                <div className="text-xs text-ink-400">coach said <span className="font-semibold text-white">{pieceLabel(r.color, r.piece)}</span></div>
                <div className="mt-0.5 text-[10px] text-ink-600">{r.by ?? "?"} · {ago(r.at)}</div>
                <div className="mt-2 flex gap-1">
                  <button disabled={busy === r.id} onClick={() => void decide(r.id, "approve")} className="flex-1 rounded bg-emerald-700 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">Approve</button>
                  <button disabled={busy === r.id} onClick={() => void decide(r.id, "reject")} className="flex-1 rounded bg-ink-800 py-1 text-xs font-semibold text-ink-200 hover:bg-rose-800 disabled:opacity-50">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
