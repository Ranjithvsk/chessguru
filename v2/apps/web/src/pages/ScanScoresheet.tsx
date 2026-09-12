// /coach-board/scoresheet — photograph a handwritten scoresheet, get the game.
// The photo must show the whole move grid, flat (rectify first if needed). The
// reader runs on the server for a few minutes; every move comes back with a
// status so the coach checks the doubtful ones (inferred → guess → unknown)
// and trusts the verified ones. Both players' copies can be uploaded together:
// where they agree the read is firmer, where they differ the coach decides.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../lib/api";

type Cell = { id: string; ink: string; san: string; status: "verified" | "agreed" | "guess" | "inferred" | "unknown"; confidence: number; inferred?: string };
type Status = { state: string; pgn?: string; cells?: Cell[] | number; summary?: Record<string, number>; seconds?: number; error?: string; cells2?: number };

const COLOUR: Record<Cell["status"], string> = {
  verified: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  agreed: "bg-ink-800 text-white border-ink-700",
  guess: "bg-amber-500/20 text-amber-100 border-amber-500/50",
  inferred: "bg-rose-500/25 text-rose-100 border-rose-500/50",
  unknown: "bg-ink-900 text-ink-300 border-ink-700 border-dashed",
};

async function fileToPng(file: File, maxSide = 2200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally { URL.revokeObjectURL(url); }
}

export default function ScanScoresheetPage() {
  const [sheet, setSheet] = useState<string | null>(null);
  const [sheet2, setSheet2] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setNow] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const s = await get<Status>(`/api/vision/scoresheet/status/${jobId}`);
        setStatus(s);
        if (s.state === "done") { setCells(Array.isArray(s.cells) ? s.cells : []); return; }
        if (s.state === "error") return;
        timer.current = window.setTimeout(tick, 4000);
      } catch (e) { setErr((e as Error).message); }
    };
    tick();
    // iPhone Safari pauses timers in the background: poll again the moment the tab is back
    const onVis = () => { if (document.visibilityState === "visible") { if (timer.current) window.clearTimeout(timer.current); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { if (timer.current) window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [jobId]);

  async function start() {
    if (!sheet) return;
    setErr(null); setStatus(null); setCells([]);
    try {
      const r = await post<{ ok: boolean; job_id: string }>("/api/vision/scoresheet/start", { imagePngBase64: sheet, image2PngBase64: sheet2 || undefined });
      setJobId(r.job_id); setStartedAt(Date.now());
    } catch (e) { setErr((e as Error).message); }
  }

  function pgn(): string {
    const out: string[] = [];
    cells.forEach((c, i) => { if (i % 2 === 0) out.push(`${i / 2 + 1}.`); out.push(c.san || "--"); });
    return out.join(" ");
  }

  const rows: Array<[number, Cell | undefined, Cell | undefined]> = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([i / 2 + 1, cells[i], cells[i + 1]]);
  const busy = !!jobId && status?.state !== "done" && status?.state !== "error";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-white">Scan a scoresheet</h1>
        <Link to="/coach-board" className="text-sm text-brand-300 hover:underline">← Coach board</Link>
      </div>
      <p className="text-sm text-ink-300">
        Photograph the whole move grid, as straight-on as you can, nothing lying on the sheet. Reading takes 2–5 minutes. Green moves are proven by
        the position; amber and red ones need your eye; grey ones are read as written but the position could not confirm them.
        Upload the opponent's copy too and the two are cross-checked.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {[["This player's sheet", sheet, setSheet], ["Opponent's sheet (optional)", sheet2, setSheet2]].map(([label, val, set]: any) => (
          <label key={label} className="block rounded-xl border border-ink-700 bg-ink-900/40 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</div>
            {/* no `capture`: on iPhone it forces the camera and hides the photo library */}
            <input type="file" accept="image/*" disabled={busy}
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) set(await fileToPng(f)); }} className="text-sm text-ink-300" />
            {val && <img src={val} alt="" className="mt-3 max-h-64 rounded-lg border border-ink-700" />}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={start} disabled={!sheet || busy}
          className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
          {busy ? (() => {
            const n = typeof status?.cells === "number" ? status.cells + (status.cells2 || 0) : 0;
            const est = n ? Math.max(60, Math.round(n * 2.6)) : 240;       // ≈2.6 s per cell on the server CPU
            const gone = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
            const left = Math.max(0, est - gone);
            return `Reading… ${status?.state || "queued"} · ${gone}s elapsed · about ${left >= 60 ? `${Math.ceil(left / 60)} min` : `${left}s`} left`;
          })() : "Read the sheet"}
        </button>
        {status?.state === "done" && <span className="text-sm text-ink-300">{cells.length} cells in {status.seconds}s ·
          {" "}verified {status.summary?.verified ?? 0}, check {(status.summary?.guess ?? 0) + (status.summary?.inferred ?? 0)}, unconfirmed {status.summary?.unknown ?? 0}</span>}
      </div>
      {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}
      {status?.state === "error" && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{status.error}</div>}

      {cells.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-ink-700">
            <table className="w-full text-sm">
              <thead className="bg-ink-900/60 text-xs uppercase tracking-wide text-ink-400"><tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">White</th><th className="px-3 py-2 text-left">Black</th></tr></thead>
              <tbody>
                {rows.map(([n, w, b]) => (
                  <tr key={n} className="border-t border-ink-800">
                    <td className="px-3 py-1.5 text-ink-400">{n}</td>
                    {[w, b].map((c, k) => (
                      <td key={k} className="px-3 py-1.5">
                        {c && (
                          <input value={c.san} title={`${c.status} · read as "${c.ink}"${c.inferred ? ` · position suggests ${c.inferred}` : ""}`}
                            onChange={(e) => setCells((cs) => cs.map((x) => x.id === c.id ? { ...x, san: e.target.value, status: "agreed" } : x))}
                            className={`w-24 rounded border px-2 py-1 font-mono ${COLOUR[c.status]}`} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">PGN</div>
            <textarea readOnly value={pgn()} className="h-28 w-full rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs text-ink-200" />
            <button onClick={() => navigator.clipboard.writeText(pgn())} className="mt-2 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-white">Copy PGN</button>
          </div>
        </>
      )}
    </div>
  );
}
