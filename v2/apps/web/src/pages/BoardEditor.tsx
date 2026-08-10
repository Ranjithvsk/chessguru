import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Board from "../components/Board";
import { useFreePlay } from "../hooks/useFreePlay";
import { detectPositionFromImage } from "../lib/boardVision";

const PRESETS: { label: string; fen: string }[] = [
  { label: "Start", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { label: "Italian", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3" },
  { label: "Sicilian", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" },
  { label: "K+P endgame", fen: "8/8/8/4k3/8/4P3/4K3/8 w - - 0 1" },
];

export default function BoardEditorPage() {
  const [sp] = useSearchParams();
  // Optional deep-link: /board-editor?fen=<encoded>&orientation=black
  // Used by the External-game viewer ("Analyze in board editor") so a user
  // can pick up an imported game at any ply and start exploring lines.
  const initialFen = sp.get("fen") || undefined;
  const initialOrientation = sp.get("orientation") === "black" ? "black" : "white";
  // Deep-link: /board-editor?fen=...&shapes=<base64url({orig,dest?,brush?}[])>
  // The snap cards in /academy pass persisted coach arrows through this so
  // opening a snap re-renders the "look at this diagonal" hint the coach drew.
  const initialShapes = (() => {
    const raw = sp.get("shapes");
    if (!raw) return undefined;
    try {
      const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
      const arr = JSON.parse(json);
      if (!Array.isArray(arr)) return undefined;
      return arr as Array<{ orig: string; dest?: string; brush?: string }>;
    } catch { return undefined; }
  })();
  const fp = useFreePlay(initialFen);
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current) return;
    if (initialFen && fp.fen !== initialFen) fp.load(initialFen);
    if (initialOrientation === "black" && fp.orientation !== "black") fp.flip();
    loadedOnce.current = true;
  }, [initialFen, initialOrientation, fp]);

  const [fenInput, setFenInput] = useState("");
  const [msg, setMsg] = useState("");
  // Screenshot → FEN pipeline. User uploads or pastes a cropped board image;
  // client-side detection (see lib/boardVision.ts) classifies each square as
  // empty / white / black. Piece TYPE is a placeholder (P/N/K/k) that the
  // coach edits via drag on the board.
  const [visionBusy, setVisionBusy] = useState(false);
  const [visionMsg, setVisionMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const [visionPreview, setVisionPreview] = useState<string | null>(null);
  const [visionMeta, setVisionMeta] = useState<{ w: number; b: number; uncertain: number } | null>(null);
  // Confidence overlay: after detection we surface every square that came in
  // below 0.6 confidence as a yellow circle on the board so the coach knows
  // exactly which cells to double-check. Cleared on "Dismiss overlay".
  const [uncertainShapes, setUncertainShapes] = useState<Array<{ orig: string; brush: string }>>([]);
  async function runVision(src: string | Blob) {
    if (visionBusy) return;
    setVisionBusy(true); setVisionMsg({ tone: "info", text: "Analysing image…" });
    try {
      const res = await detectPositionFromImage(src);
      const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const shapes: Array<{ orig: string; brush: string }> = [];
      let uncertain = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const conf = res.confidence[r]?.[c] ?? 1;
          if (conf < 0.6) {
            uncertain++;
            shapes.push({ orig: `${files[c]}${8 - r}`, brush: "yellow" });
          }
        }
      }
      setUncertainShapes(shapes);
      setVisionPreview(res.imageDataUrl);
      setVisionMeta({ w: res.meta.whiteCount, b: res.meta.blackCount, uncertain });
      const ok = fp.load(res.fen);
      if (ok) {
        const nudge = uncertain > 0
          ? ` ⚠ ${uncertain} yellow-ringed square${uncertain === 1 ? "" : "s"} need a second look.`
          : "";
        setVisionMsg({ tone: "ok", text: `Loaded ${res.meta.whiteCount}W + ${res.meta.blackCount}B. Placeholders are pawns / knights — drag to fix types.${nudge}` });
      }
      else setVisionMsg({ tone: "err", text: "Detected but couldn't load (illegal position). Try a cleaner screenshot." });
    } catch (e) {
      setVisionMsg({ tone: "err", text: String((e as Error).message || e) });
    } finally { setVisionBusy(false); }
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    void runVision(f);
    // Clear so re-uploading the same file re-triggers.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  // Clipboard-paste anywhere on the page: grabs the first image on the
  // clipboard and pipes it through the same detection flow.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) { e.preventDefault(); void runVision(blob); return; }
        }
      }
    };
    window.addEventListener("paste", onPaste as any);
    return () => window.removeEventListener("paste", onPaste as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFen = () => {
    if (fp.load(fenInput.trim())) setMsg("Loaded.");
    else setMsg("Invalid FEN.");
    setTimeout(() => setMsg(""), 1500);
  };
  const copyFen = () => { navigator.clipboard?.writeText(fp.fen); setMsg("FEN copied."); setTimeout(() => setMsg(""), 1500); };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <Board fen={fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
          movableColor="both" dests={fp.dests} onMove={fp.onMove}
          shapes={(uncertainShapes.length > 0 ? uncertainShapes : initialShapes) as any} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={fp.undo} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">◀ Undo</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={copyFen} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Copy FEN</button>
          {uncertainShapes.length > 0 && (
            <button onClick={() => setUncertainShapes([])}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/20"
              title="Hide the yellow uncertain-square rings">
              ⚠ Dismiss {uncertainShapes.length} ring{uncertainShapes.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h1 className="mb-3 font-display text-xl text-white">Board / Analysis</h1>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Load FEN</label>
          <textarea value={fenInput} onChange={(e) => setFenInput(e.target.value)} rows={2}
            placeholder="Paste a FEN to set up any position"
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500" />
          <button onClick={loadFen} className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-500">Load position</button>
          {msg && <p className="mt-2 text-sm text-accent-400">{msg}</p>}
          <div className="mt-3 break-all rounded-lg bg-ink-950 p-2 font-mono text-xs text-ink-400">{fp.fen}</div>
        </div>

        <div className="rounded-xl2 border border-brand-500/30 bg-brand-500/5 p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-200">📷 Load from image</h2>
            <span className="text-[10px] text-ink-500">Ctrl-V paste works too</span>
          </div>
          <p className="mb-2 text-[11px] text-ink-400 leading-snug">
            Upload a cropped chess screenshot (Lichess / Chess.com / any diagram). Detection is naive right now — colours + occupancy only; piece TYPE comes back as a pawn placeholder. Drag pieces around to fix the position, then Copy FEN.
          </p>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile}
            className="block w-full text-[11px] text-ink-300 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1 file:text-white file:hover:bg-brand-500" />
          {visionMsg && (
            <div className={`mt-2 rounded border px-2 py-1 text-[11px] ${visionMsg.tone === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : visionMsg.tone === "err" ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
              : "border-ink-700 bg-ink-800 text-ink-300"}`}>
              {visionBusy && "⏳ "}
              {visionMsg.text}
            </div>
          )}
          {visionPreview && (
            <div className="mt-2 flex items-start gap-2">
              <img src={visionPreview} alt="Cropped board" className="h-24 w-24 rounded border border-ink-700" />
              {visionMeta && (
                <div className="text-[11px] text-ink-400 leading-snug">
                  <div><b className="text-ink-200">{visionMeta.w}</b> white · <b className="text-ink-200">{visionMeta.b}</b> black</div>
                  {visionMeta.uncertain > 0 && <div className="text-amber-300 mt-0.5">{visionMeta.uncertain} uncertain square{visionMeta.uncertain === 1 ? "" : "s"}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Presets</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => fp.load(p.fen)}
                className="rounded-full border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">{p.label}</button>
            ))}
          </div>
        </div>

        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</h2>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-300">
            {fp.history.length === 0 ? <span className="text-ink-500">No moves yet.</span>
              : fp.history.map((san, i) => (
                <span key={i}>{i % 2 === 0 && <span className="text-ink-500">{Math.floor(i / 2) + 1}.</span>} {san}</span>
              ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">Engine analysis coming with the v2 API (the old /api/engine/analyze endpoint isn't available).</p>
        </div>
      </aside>
    </div>
  );
}
