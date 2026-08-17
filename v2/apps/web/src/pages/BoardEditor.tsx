import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Chess } from "chess.js";
import Board from "../components/Board";
import type { Key } from "chessground/types";
import { useFreePlay } from "../hooks/useFreePlay";
import { detectPositionFromImage } from "../lib/boardVision";
import { warpWithCorners } from "../lib/boardWarp";
import { CornerAdjuster, type Corner } from "../components/CornerAdjuster";

// Vision pipeline shipped 2026-08-11 but recalled 2026-08-12: auto-detect
// mis-crops phone photos of book pages, classifier returns illegal FEN.
// Owner directive: don't ship broken AI. Flip to true after we have a
// proper neural board-corner detector + a v-training corpus of real
// user photos. Keeping code + endpoint wiring intact so re-enabling is
// a one-flag change.
const VISION_UI_ENABLED = true;
import {
  addServerReferences,
  extractSilhouetteFromSquare,
  silhouetteToPngDataUrl,
  type PieceType,
} from "../lib/pieceClassifier";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

/** One-time (page-load-scoped) fetch of the server-side reference bank so
 *  coach-corrections from other coaches boost the detector before the user
 *  opens the vision panel. Fails silently -- offline / API down still
 *  gives us the built-in cburnett templates. */
let refsLoaded = false;
async function loadServerRefsOnce(): Promise<void> {
  if (refsLoaded) return;
  refsLoaded = true;
  try {
    const r = await fetch(`${API_BASE}/api/vision/references`, { credentials: "include" });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j?.references)) await addServerReferences(j.references);
  } catch { /* silent -- bank still has cburnett defaults */ }
}

/** Decode a data URL back to a canvas so we can crop per-square patches on
 *  Apply. detectPositionFromImage returns the cropped 480x480 board as a
 *  PNG data URL; we reconstitute it here for correction capture. */
function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("failed to decode vision preview"));
    img.src = dataUrl;
  });
}

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
  // Frozen from the last successful vision run so we can compute a diff of
  // (vision-detected type) vs (coach-corrected type) on Apply and upload the
  // deltas as new templates for future detections.
  const [visionSnapshot, setVisionSnapshot] = useState<{ types: (PieceType | null)[][]; canvas: HTMLCanvasElement; renderMode: "screen" | "print" } | null>(null);
  // v3 Server AI ("DINOv2 nearest-neighbour"). Sends the cropped board to
  // the backend classifier; ~3-6s per board.
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  // Manual corner adjuster (fallback when auto-detect crops wrong).
  // Keeps the raw uploaded image dataURL so the coach can re-warp with
  // manually-placed corners. Null when adjuster is closed.
  const [adjusterOpen, setAdjusterOpen] = useState(false);
  const [rawUploadDataUrl, setRawUploadDataUrl] = useState<string | null>(null);
  // Fetch the crowd-sourced reference bank on first mount. See loadServerRefsOnce.
  useEffect(() => { void loadServerRefsOnce(); }, []);
  // NB: previously auto-preloaded OpenCV.js here to "warm the cache" for
  // Adjust-Corners. Removed 2026-08-17 — the 10 MB <script> load runs the
  // WASM init on the main thread and froze the tab for 5-10 sec on mobile
  // right after upload. OpenCV now loads on-demand ONLY if the user opens
  // Adjust Corners (which pays that cost visibly, not silently at mount).
  // Position-editor mode: when on, board clicks PLACE a piece (from palette)
  // or CLEAR the square. Uses a private Chess() so we can put/remove without
  // chess.js's move-legality guard rejecting arbitrary edits. Applying the
  // edit calls fp.load() which routes it back through the standard board
  // state and re-validates.
  const [editMode, setEditMode] = useState(false);
  const [palettePick, setPalettePick] = useState<string | null>(null); // e.g. "K", "p", or "-" (erase)
  const [editSide, setEditSide] = useState<"w" | "b">("w");
  const editorRef = useRef<Chess>(new Chess());
  const [editorTick, setEditorTick] = useState(0); // force re-render on editor mutations
  useEffect(() => {
    // Sync editor buffer from current board state whenever the user enters
    // edit mode. Prevents a stale buffer from wiping recent moves.
    if (editMode) {
      try { editorRef.current.load(fp.fen); } catch { /* fall back to empty */ editorRef.current.clear(); }
      setEditorTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);
  function onSquareClick(sq: Key) {
    if (!editMode) return;
    const g = editorRef.current;
    if (palettePick === "-") { g.remove(sq as any); setEditorTick((n) => n + 1); return; }
    if (!palettePick) return;
    const color: "w" | "b" = palettePick === palettePick.toUpperCase() ? "w" : "b";
    const type = palettePick.toLowerCase() as "k" | "q" | "r" | "b" | "n" | "p";
    try {
      g.remove(sq as any);
      g.put({ type, color }, sq as any);
      setEditorTick((n) => n + 1);
    } catch { /* invalid square */ }
  }
  function applyEditor() {
    // Rebuild FEN with the currently-picked side-to-move + no castling
    // rights (safest default; coach can hand-edit the FEN if they need
    // castling later). Full FEN needed so chess.js accepts it back.
    const g = editorRef.current;
    const board = g.fen().split(" ")[0]!;
    const next = `${board} ${editSide} - - 0 1`;
    if (fp.load(next)) {
      // Diff coach edits vs the last vision run. Three kinds of correction
      // are uploaded to the server-side reference bank:
      //   1. WRONG TYPE: vision detected a piece of the same colour but a
      //      different type -- upload as a labelled ref for that (piece,color).
      //   2. FALSE POSITIVE (empty→piece in vision, empty in editor): vision
      //      hallucinated a piece on an empty square -- upload as an "empty"
      //      ref so future classifications learn "this cell content == blank."
      //   3. FALSE NEGATIVE (piece in vision detected as absent): rarely
      //      catchable here (occupancy detector is separate) -- skipped.
      let sent = 0;
      if (visionSnapshot) {
        const cell = visionSnapshot.canvas.width / 8;
        const ctx = visionSnapshot.canvas.getContext("2d")!;
        const boardArr = g.board();       // 8x8 (rank 8 top → rank 1 bottom, file a → h)
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const cell88 = boardArr[r]?.[c];
            const visionType = visionSnapshot.types[r]?.[c];
            // Prepare the raw crop once (used by both correction paths).
            const buildRawCrop = () => {
              const rawC = document.createElement("canvas");
              rawC.width = cell; rawC.height = cell;
              rawC.getContext("2d")!.drawImage(visionSnapshot.canvas, c * cell, r * cell, cell, cell, 0, 0, cell, cell);
              return rawC.toDataURL("image/png");
            };
            const buildSilhouette = (color: "w" | "b") => {
              const sig = extractSilhouetteFromSquare(ctx, c * cell, r * cell, cell, cell, color, visionSnapshot.renderMode);
              return silhouetteToPngDataUrl(sig);
            };
            // CASE 2: vision said this cell had a piece, coach cleared it.
            if (visionType && !cell88) {
              try {
                void fetch(`${API_BASE}/api/vision/feedback`, {
                  method: "POST", credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ piece: "empty", color: "w", silhouettePng: buildSilhouette("w"), rawCropPng: buildRawCrop() }),
                }).catch(() => {});
                sent++;
              } catch { /* silent */ }
              continue;
            }
            // CASE 1: wrong type at the same square.
            if (!cell88 || !visionType) continue;
            const coachType = cell88.type.toUpperCase() as PieceType;
            if (coachType === visionType) continue;   // no correction
            try {
              void fetch(`${API_BASE}/api/vision/feedback`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ piece: coachType, color: cell88.color, silhouettePng: buildSilhouette(cell88.color as "w" | "b"), rawCropPng: buildRawCrop() }),
              }).catch(() => {});
              sent++;
            } catch { /* silent */ }
          }
        }
      }
      setMsg(sent > 0
        ? `Position applied. Shared ${sent} correction${sent === 1 ? "" : "s"} to improve future detection.`
        : "Position applied.");
      setEditMode(false);
    } else {
      setMsg("Illegal position (need one K and one k, kings not adjacent, no pawns on ranks 1/8).");
    }
    setTimeout(() => setMsg(""), 3500);
  }
  // Preview FEN of the in-flight editor buffer (drives the board while edit
  // mode is active so clicks appear immediately).
  const editorFen = editMode ? `${editorRef.current.fen().split(" ")[0]} ${editSide} - - 0 1` : null;
  void editorTick; // include in render deps
  async function runVision(src: string | Blob) {
    if (visionBusy) return;
    setVisionBusy(true); setVisionMsg({ tone: "info", text: "Analysing image…" });
    // Cache the raw uploaded image as a data URL so the manual
    // CornerAdjuster can re-warp with user-placed corners later.
    let rawDataUrl = "";
    try {
      if (typeof src === "string") {
        rawDataUrl = src.startsWith("data:") ? src : `data:image/png;base64,${src}`;
      } else {
        rawDataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error("read"));
          fr.readAsDataURL(src);
        });
      }
      setRawUploadDataUrl(rawDataUrl);
      const b64 = rawDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
      // Guarantee the raw uncropped upload lands on the server, even if
      // Ultra AI doesn't fire. Await so the request completes before any
      // subsequent navigation. NOTE: cannot use `keepalive: true` — browsers
      // cap keepalive-fetch bodies at 64 KB, and raw phone photos are >1 MB.
      try {
        await fetch(`${API_BASE}/api/vision/log-scan`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ boardPngBase64: b64, source: "board-editor-upload" }),
        });
      } catch { /* silent — best-effort */ }
    } catch { /* silent */ }
    // Fire Ultra AI IMMEDIATELY on the raw image. This is the reliable
    // path — server runs its own YOLOv8n-seg extractor + YOLOv8n-cls
    // classifier + chess-rules validation. Works whether or not OpenCV.js
    // loads on the client. Pass rawDataUrl directly since React state
    // hasn't propagated yet. Clear the "Analysing image…" visionMsg —
    // Ultra AI's own progress (serverMsg) takes over as the user-visible
    // status. Prevents the "Analysing image…" spinner sticking forever
    // when the client-side OpenCV.js branch hangs.
    setVisionMsg(null);
    setVisionBusy(false);
    // Fire Ultra AI raw-only immediately as fast path. The reliable second
    // call (with client warp attached) fires below after detectPositionFromImage
    // completes. If server's raw extract works, user sees result in ~2s. If it
    // returns warpQuality:"bad", the client-warp call overwrites with the good
    // result once it lands (~5-8s total).
    void runUltraScan(undefined, rawDataUrl);
    // DISABLED heavy client-side detectPositionFromImage on the auto-upload
    // path — it loads OpenCV.js (10 MB parse) + runs 64 onnxruntime-web
    // inferences on the main thread, freezing the page for 7-10 seconds on
    // mobile (users saw a blank page with no loading indicator). Ultra AI
    // (server-side) delivers the same result without blocking. If the crop
    // is bad, ENG-1's warpQuality gate auto-opens CornerAdjuster, and
    // OpenCV.js only loads on-demand when the user hits Confirm.
  }
  /** Send the given cropped-board canvas to the v3.6 server classifier.
   *  Extracted from runServerClassify so we can auto-trigger it right
   *  after the client-side warp/crop finishes (with the warped canvas)
   *  as well as from the manual button. */
  async function runServerClassifyOnCanvas(canvas: HTMLCanvasElement) {
    if (serverBusy) return;
    setServerBusy(true); setServerMsg({ tone: "info", text: "🚀 Server AI classifying (3-30s)…" });
    try {
      const boardPngBase64 = canvas.toDataURL("image/png");
      const r = await fetch(`${API_BASE}/api/vision/classify-board-v2`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardPngBase64 }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // Always populate. Even an illegal position preserves the correct pieces
      // so the coach only fixes the wrong squares instead of starting empty.
      const placed = fp.loadPermissive(j.fen);
      const legal = fp.load(j.fen);
      const avgConf = (j.squares.flat().reduce((s: number, sq: any) => s + sq.confidence, 0) / 64 * 100).toFixed(0);
      const pieceCount = j.fen.split(" ")[0].replace(/[^KQRBNPkqrbnp]/g, "").length;
      setServerMsg({
        tone: placed ? "ok" : "err",
        text: placed
          ? (legal
              ? `✓ Server AI loaded ${pieceCount} pieces (avg conf ${avgConf}%, ${j.meta.latencyMs}ms).`
              : `Server AI placed ${pieceCount} pieces (avg conf ${avgConf}%). Position illegal — fix the misread squares.`)
          : `Server FEN unparseable: ${j.fen}`,
      });
    } catch (e) {
      setServerMsg({ tone: "err", text: `Server AI failed: ${(e as Error).message.slice(0, 120)}` });
    } finally { setServerBusy(false); }
  }
  /** Manual "Try Server AI" button handler -- uses whatever snapshot the
   *  last client detection produced. Same code path as the auto-trigger
   *  in runVision, but wired to the visible button so coaches can re-run
   *  server classification on demand (e.g. after adjusting orientation). */
  async function runServerClassify() {
    if (!visionSnapshot) { setServerMsg({ tone: "err", text: "Upload a board image first." }); return; }
    await runServerClassifyOnCanvas(visionSnapshot.canvas);
  }
  /** "Ultra AI" — MIT YOLO extractor + 3-model classifier ensemble on the
   *  server. If we already have a tight client-warped board (from OpenCV.js
   *  detection), pass it in — the server will skip its extractor and use it.
   *  This fixes iPad screen photos where the server extractor over-reaches
   *  into UI chrome (title bar/bezel) and misaligns the 8×8 tile split.
   *  Latency ~1-3s. */
  async function runUltraScan(warpedCanvas?: HTMLCanvasElement, rawDataUrlOverride?: string) {
    // rawDataUrlOverride lets runVision pass the raw synchronously (before
    // React state has propagated). Falls back to state for the manual button.
    const raw = rawDataUrlOverride || rawUploadDataUrl;
    if (!raw) { setServerMsg({ tone: "err", text: "Upload an image first." }); return; }
    // Bypass serverBusy guard when we have a client-side warp — that call
    // is the "reliable path" (server skips its flaky extractor). Should
    // overwrite the earlier raw-only call if it's still in flight.
    if (serverBusy && !warpedCanvas) return;
    setServerBusy(true);
    setServerMsg({
      tone: "info",
      text: warpedCanvas
        ? "✨ Ultra AI (reliable): using client warp, skipping server extract…"
        : "✨ Ultra AI: extract + ensemble classify (1-3s)…",
    });
    try {
      const rawB64 = raw.replace(/^data:image\/[a-z]+;base64,/, "");
      const body: { rawImagePngBase64: string; warpedBoardPngBase64?: string } = { rawImagePngBase64: rawB64 };
      if (warpedCanvas) {
        body.warpedBoardPngBase64 = warpedCanvas.toDataURL("image/png").replace(/^data:image\/[a-z]+;base64,/, "");
      }
      const r = await fetch(`${API_BASE}/api/vision/classify-board-ultra`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // Warp-quality gate: if the server graded the crop "bad" (mis-aligned to
      // 8x8 grid, black-bar bleed, off-board scene, app screenshot with UI
      // chrome), skip populating the garbage FEN and auto-open the Adjust
      // Corners modal so the user can draw the board edges. The OpenCV freeze
      // that made us disable this earlier is fixed (pre-scale + no preload
      // + only-on-demand load).
      const wq = j.warpQuality as { quality?: string; score?: number } | undefined;
      if (wq?.quality === "bad") {
        setServerMsg({
          tone: "err",
          text: `Auto-crop looked wrong (score ${wq.score ?? 0}). Drag the 4 corners onto the true board edges, then tap Confirm.`,
        });
        setAdjusterOpen(true);
        return;
      }
      const placed = fp.loadPermissive(j.fen);
      const legal = fp.load(j.fen);
      const avgConf = (j.squares.flat().reduce((s: number, sq: any) => s + sq.confidence, 0) / 64 * 100).toFixed(0);
      const pieceCount = j.fen.split(" ")[0].replace(/[^KQRBNPkqrbnp]/g, "").length;
      const timing = `extract ${j.extractLatencyMs}ms + classify ${j.meta.latencyMs}ms`;
      // Per-square uncertain rings: yellow ring on any square below 0.7
      // confidence so the coach immediately sees which cells to double-check.
      const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const shapes: Array<{ orig: string; brush: string }> = [];
      let uncertain = 0;
      for (let r2 = 0; r2 < 8; r2++) {
        for (let c2 = 0; c2 < 8; c2++) {
          const conf = j.squares[r2]?.[c2]?.confidence ?? 1;
          if (conf < 0.7) {
            uncertain++;
            shapes.push({ orig: `${files[c2]}${8 - r2}`, brush: "yellow" });
          }
        }
      }
      setUncertainShapes(shapes);
      const uncertainTag = uncertain > 0 ? ` · ⚠ ${uncertain} uncertain` : "";
      setServerMsg({
        tone: placed ? "ok" : "err",
        text: placed
          ? (legal
              ? `✨ Ultra AI: ${pieceCount} pieces, avg conf ${avgConf}% (${timing}${uncertainTag}).`
              : `✨ Ultra AI placed ${pieceCount} pieces (conf ${avgConf}%${uncertainTag}). Position illegal — fix the misread squares.`)
          : `Ultra AI unparseable FEN: ${j.fen}`,
      });
    } catch (e) {
      setServerMsg({ tone: "err", text: `Ultra AI failed: ${(e as Error).message.slice(0, 160)}` });
    } finally { setServerBusy(false); }
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
  /** Rotate the position 180° in-place. Used when a scan comes back with
   *  pieces correctly identified but the board oriented upside-down — a
   *  common failure for iPad/tablet photos where the coordinate labels
   *  are cropped off and the classifier can't tell which way is "up". */
  const rotate180 = () => {
    const cur = fp.fen.split(" ")[0];
    // Expand each rank to 8 chars, reverse, then re-collapse
    const ranks = cur.split("/").map((rk) => {
      let out = "";
      for (const ch of rk) {
        if (/\d/.test(ch)) out += ".".repeat(parseInt(ch, 10));
        else out += ch;
      }
      return out.padEnd(8, ".").slice(0, 8);
    });
    // 180° rotation = reverse rank order AND reverse each rank left-right
    const rotated = ranks.reverse().map((rk) => rk.split("").reverse().join(""));
    // Collapse "." runs back to digits
    const collapse = (rk: string) => rk.replace(/\.+/g, (m) => String(m.length));
    const rest = fp.fen.split(" ").slice(1).join(" ") || "w - - 0 1";
    const newFen = rotated.map(collapse).join("/") + " " + rest;
    if (!fp.loadPermissive(newFen)) setMsg("Rotate failed."), setTimeout(() => setMsg(""), 1500);
    else setMsg("Rotated 180°."), setTimeout(() => setMsg(""), 1200);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Big top-of-screen status banner so users know a scan is in flight —
       *  previous <11px badges got missed below the fold on mobile and users
       *  reported "no response". Fixed to viewport top so it's always visible. */}
      {serverBusy && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-brand-500 px-3 py-2 text-center text-sm font-semibold text-white shadow-lg">
          <span className="inline-block animate-pulse">⏳</span>
          {" "}
          {serverMsg?.text || "Processing image…"}
        </div>
      )}
      <section>
        <Board fen={editorFen ?? fp.fen} orientation={fp.orientation} turnColor={fp.turnColor}
          movableColor={editMode ? undefined : "both"} dests={editMode ? new Map() : fp.dests}
          onMove={editMode ? undefined : fp.onMove}
          onSelect={editMode ? onSquareClick : undefined}
          shapes={(uncertainShapes.length > 0 ? uncertainShapes : initialShapes) as any} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={fp.undo} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">◀ Undo</button>
          <button onClick={fp.reset} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Reset</button>
          <button onClick={fp.flip} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">⇅ Flip</button>
          <button onClick={rotate180} title="Rotate the position 180° — fixes upside-down scans (tablet in landscape, book at wrong angle, etc.)" className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">🔄 Rotate 180°</button>
          <button onClick={copyFen} className="rounded-lg border border-ink-600 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800">Copy FEN</button>
          {uncertainShapes.length > 0 && (
            <button onClick={() => setUncertainShapes([])}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/20"
              title="Hide the yellow uncertain-square rings">
              ⚠ Dismiss {uncertainShapes.length} ring{uncertainShapes.length === 1 ? "" : "s"}
            </button>
          )}
          <button onClick={() => setEditMode((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-sm ${editMode
              ? "border-brand-500/60 bg-brand-500/15 text-brand-100 hover:bg-brand-500/25"
              : "border-ink-600 text-ink-300 hover:bg-ink-800"}`}
            title="Toggle position-editor mode. Click a palette piece then click a square to place. Click 🗑 then a square to erase.">
            {editMode ? "✕ Exit edit" : "✎ Edit position"}
          </button>
        </div>
        {editMode && (
          <div className="mt-3 rounded-xl2 border border-brand-500/40 bg-brand-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="uppercase tracking-wide text-brand-200">✎ Position editor</span>
              <div className="flex items-center gap-2">
                <span className="text-ink-400">Side to move</span>
                <button onClick={() => setEditSide("w")}
                  className={`rounded-full border px-2 py-0.5 font-semibold ${editSide === "w" ? "border-brand-500/60 bg-brand-500/15 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>White</button>
                <button onClick={() => setEditSide("b")}
                  className={`rounded-full border px-2 py-0.5 font-semibold ${editSide === "b" ? "border-brand-500/60 bg-brand-500/15 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>Black</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {["K", "Q", "R", "B", "N", "P", "-", "k", "q", "r", "b", "n", "p"].map((sym) => {
                const label = sym === "-" ? "🗑" : sym;
                const isSelected = palettePick === sym;
                const isWhite = sym !== "-" && sym === sym.toUpperCase();
                const isErase = sym === "-";
                return (
                  <button key={sym} onClick={() => setPalettePick((p) => (p === sym ? null : sym))}
                    title={isErase ? "Erase mode: click a square to empty it" : `${isWhite ? "White" : "Black"} ${{ k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" }[sym.toLowerCase()]}`}
                    className={`aspect-square rounded font-bold text-lg leading-none ${isSelected
                      ? "border-2 border-brand-400 bg-brand-500/25 text-brand-50"
                      : isErase
                        ? "border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                        : isWhite
                          ? "border border-ink-600 bg-ink-100 text-ink-950 hover:bg-ink-200"
                          : "border border-ink-600 bg-ink-950 text-ink-100 hover:bg-ink-800"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-400">
              <span>{palettePick === "-" ? "Erasing" : palettePick ? `Selected: ${palettePick} — click a square to place` : "Click a piece above, then a square"}</span>
              <button onClick={() => { editorRef.current.clear(); setEditorTick((n) => n + 1); }}
                className="ml-auto rounded-full border border-ink-600 px-2 py-0.5 text-ink-300 hover:bg-ink-800"
                title="Empty the board">
                Clear board
              </button>
              <button onClick={applyEditor}
                className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-500"
                title="Apply the edited position back to the analysis board">
                Apply
              </button>
            </div>
          </div>
        )}
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

        {/* Vision panel disabled 2026-08-12 (VISION_UI_ENABLED flag) --
            board detection fails reliably on phone photos of book pages.
            Re-enable when a proper neural board-corner detector ships. */}
        {VISION_UI_ENABLED && <div className="rounded-xl2 border border-brand-500/30 bg-brand-500/5 p-5">
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
          {rawUploadDataUrl && (
            <div className="mt-3 border-t border-brand-500/20 pt-2 flex flex-wrap gap-2 items-center">
              {visionSnapshot && (
                <button onClick={runServerClassify} disabled={serverBusy}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:cursor-wait disabled:bg-brand-800">
                  {serverBusy ? "🚀 Classifying…" : "🚀 Try Server AI (DINOv2)"}
                </button>
              )}
              <button onClick={() => runUltraScan()} disabled={serverBusy}
                className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-fuchsia-600 to-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-fuchsia-500 hover:to-brand-500 disabled:cursor-wait disabled:opacity-60"
                title="Ultra AI: YOLO segmentation extractor + ensemble classifier. Retries the scan.">
                {serverBusy ? "✨ Working…" : "✨ Retry Ultra AI"}
              </button>
              <button onClick={() => setAdjusterOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20">
                ✂ Adjust corners
              </button>
              <span className="text-[10px] text-ink-500 w-full">Auto-crop wrong? Tap "Adjust corners" to draw the board edges yourself.</span>
              {serverMsg && (
                <div className={`mt-1 w-full rounded border px-2 py-1 text-[11px] ${serverMsg.tone === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : serverMsg.tone === "err" ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
                  : "border-ink-700 bg-ink-800 text-ink-300"}`}>
                  {serverMsg.text}
                </div>
              )}
            </div>
          )}
        </div>}
        {VISION_UI_ENABLED && adjusterOpen && rawUploadDataUrl && (
          <CornerAdjuster
            imageSrc={rawUploadDataUrl}
            onCancel={() => setAdjusterOpen(false)}
            onConfirm={async (corners: Corner[]) => {
              setAdjusterOpen(false);
              setServerBusy(true);
              setServerMsg({ tone: "info", text: "✂ Warping with your corners on the server…" });
              try {
                const rawB64 = rawUploadDataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
                // SERVER-SIDE warp — replaces the 10 MB opencv.js download that
                // was killing cellular users. Server does cv2 warp in ~200ms
                // and returns a 512x512 board PNG we can classify.
                const warpR = await fetch(`${API_BASE}/api/vision/warp-with-corners`, {
                  method: "POST", credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rawImagePngBase64: rawB64, corners }),
                });
                if (!warpR.ok) throw new Error(`server warp ${warpR.status}: ${(await warpR.text()).slice(0, 120)}`);
                const warpJ = await warpR.json();
                if (!warpJ?.boardPngBase64) throw new Error("server warp returned no board");
                // Save corner labels for the nightly retrain (awaited so it
                // doesn't get dropped by iOS Safari queue).
                try {
                  const saveR = await fetch(`${API_BASE}/api/vision/save-corner-labels`, {
                    method: "POST", credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rawImagePngBase64: rawB64, corners, sourceRef: "board-editor-adjust" }),
                  });
                  if (saveR.ok) setServerMsg({ tone: "ok", text: "✓ Corners saved. Classifying…" });
                } catch { /* save failure shouldn't block the classify below */ }
                // Set preview + classify using the server's warped board
                setVisionPreview(`data:image/png;base64,${warpJ.boardPngBase64}`);
                setServerMsg({ tone: "info", text: "🚀 Server AI classifying (2-8s)…" });
                const classR = await fetch(`${API_BASE}/api/vision/classify-board-v2`, {
                  method: "POST", credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ boardPngBase64: warpJ.boardPngBase64 }),
                });
                if (!classR.ok) throw new Error(`classify ${classR.status}: ${(await classR.text()).slice(0, 120)}`);
                const classJ = await classR.json();
                const placed = fp.loadPermissive(classJ.fen);
                const legal = fp.load(classJ.fen);
                const pieceCount = classJ.fen.split(" ")[0].replace(/[^KQRBNPkqrbnp]/g, "").length;
                const avgConf = (classJ.squares.flat().reduce((s: number, sq: any) => s + sq.confidence, 0) / 64 * 100).toFixed(0);
                setServerMsg({
                  tone: placed ? "ok" : "err",
                  text: placed
                    ? `${legal ? "✓" : "⚠"} Loaded ${pieceCount} pieces (conf ${avgConf}%). ${legal ? "" : "Position illegal — fix wrong squares."}`
                    : "Couldn't parse FEN.",
                });
              } catch (e) {
                setServerMsg({ tone: "err", text: `Manual warp failed: ${(e as Error).message.slice(0, 160)}` });
              } finally { setServerBusy(false); }
            }}
          />
        )}

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
