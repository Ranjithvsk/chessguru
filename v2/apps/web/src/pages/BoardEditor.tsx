import { useState } from "react";
import Board from "../components/Board";
import { useFreePlay } from "../hooks/useFreePlay";

const PRESETS: { label: string; fen: string }[] = [
  { label: "Start", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { label: "Italian", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3" },
  { label: "Sicilian", fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" },
  { label: "K+P endgame", fen: "8/8/8/4k3/8/4P3/4K3/8 w - - 0 1" },
];

export default function BoardEditorPage() {
  const fp = useFreePlay();
  const [fenInput, setFenInput] = useState("");
  const [msg, setMsg] = useState("");

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
          movableColor="both" dests={fp.dests} onMove={fp.onMove} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={fp.undo} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">◀ Undo</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={copyFen} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Copy FEN</button>
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
