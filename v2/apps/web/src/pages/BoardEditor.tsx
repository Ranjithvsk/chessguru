import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

/** The vision service answers with the board field alone — "3rr2k/pppqn2p/..."
 *  — not a complete FEN. chess.js requires all six fields and rejects the short
 *  form, so any legality check run on the raw value fails regardless of the
 *  position. Fill in sensible defaults for the fields a scanned diagram cannot
 *  know: White to move, no castling rights, no en-passant square. */
function normalizeScanFen(fen: string): string {
  const parts = (fen || "").trim().split(/\s+/);
  if (parts.length >= 6) return fen.trim();
  const board = parts[0] || "";
  return `${board} w - - 0 1`;
}

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
  const navigate = useNavigate();
  // ?returnTo=/studies/<sid>/edit/<cid>: opened from a study to scan a
  // notebook diagram; "Use in study" carries the FEN back as ?fen=.
  const returnTo = sp.get("returnTo");
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
  /** Every board the extractor found, when a page holds more than one. A book
   *  page of puzzles has six diagrams; the scanner used to collapse them into a
   *  single crop spanning several boards and return a confident nonsense FEN.
   *  The extractor already finds all of them (6/6 at 0.93-0.95 on the page that
   *  produced TKT-166's sibling failure), so we show them and let the coach say
   *  which position they meant. */
  const [boardChoices, setBoardChoices] = useState<
    Array<{ index: number; confidence: number; boardPngBase64: string }>
  >([]);
  const [rawUploadDataUrl, setRawUploadDataUrl] = useState<string | null>(null);
  /** The last Ultra scan, kept so we can tell what the COACH changed.
   *  Correction capture used to fire only from Edit position -> Apply, a path
   *  almost nobody takes: the natural fix is to drag a piece and copy the FEN.
   *  Result was 140 stored corrections, none since 11 August, while the
   *  classifier stayed wrong on exactly the squares people were fixing by
   *  hand. This is the only ground truth we generate, so capture it from the
   *  path people actually use. */
  const [scanRef, setScanRef] = useState<
    { squares: any[][]; boardPngBase64: string; fen: string } | null
  >(null);
  const scanUploadedRef = useRef<string>("");
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
  const lastScanIdRef = useRef<string | null>(null);
  const [scanConfirmed, setScanConfirmed] = useState(false);
  // "Use this position" (feature 1): a positive confirmation beats silence. The weak-square count
  // rides along so the record says those squares were looked at, not merely tolerated (feature 2).
  const confirmScan = async () => {
    const id = lastScanIdRef.current; if (!id) return;
    setScanConfirmed(true);
    try {
      await fetch(`${API_BASE}/api/vision/scan/${encodeURIComponent(id)}/accept`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalFen: fp.fen, weakConfirmed: visionMeta?.uncertain ?? 0 }),
      });
      setMsg("✓ Marked correct — thank you, that helps the scanner learn.");
    } catch { /* best-effort */ }
  };
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
                  body: JSON.stringify({ scanId: lastScanIdRef.current ?? undefined, piece: "empty", color: "w", silhouettePng: buildSilhouette("w"), rawCropPng: buildRawCrop() }),
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
                body: JSON.stringify({ scanId: lastScanIdRef.current ?? undefined, piece: coachType, color: cell88.color, silhouettePng: buildSilhouette(cell88.color as "w" | "b"), rawCropPng: buildRawCrop() }),
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
      // Scanning now requires a session (it is a coach tool, and an open
      // inference endpoint can be farmed to copy the model). Say so plainly
      // instead of surfacing a raw 401 body.
      if (r.status === 401) throw new Error("Please sign in to scan a position — the scanner is for signed-in coaches and students.");
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // Always populate. Even an illegal position preserves the correct pieces
      // so the coach only fixes the wrong squares instead of starting empty.
      // The vision service returns the BOARD FIELD ONLY ("3rr2k/pppqn2p/...").
      // chess.js rejects a one-field FEN outright, so fp.load() was failing on
      // every scan and we told the coach "Position illegal — fix the misread
      // squares" even when all 64 squares were right. Verified 2026-09-09: a
      // scan that reproduced its book diagram exactly was reported illegal.
      // loadPermissive already retried with the missing fields appended, which
      // is why the board itself looked correct while the message contradicted
      // it. Normalise once, then both calls agree.
      const fullFen = normalizeScanFen(j.fen);
      const placed = fp.loadPermissive(fullFen);
      const legal = fp.load(fullFen);
      // The server now records every classified board and hands back its id. Corrections made
      // to this board carry it, so the admin analytics can tell "accepted as read" from "edited".
      lastScanIdRef.current = typeof j.scanId === "string" ? j.scanId : null;
      setScanConfirmed(false);
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
  /** Re-classify using the crop the last client-side detection produced,
   *  rather than letting the server extractor pick the region again.
   *
   *  This used to call runServerClassifyOnCanvas (the in-process DINOv2 route,
   *  self-described as "3-30s"). That route runs 64 model forwards on Node's
   *  single thread, so while it worked NOTHING else the API serves could be
   *  answered — including live class WebSockets and /api/health. It now goes
   *  through the Ultra microservice like every other scan path. See the note
   *  on the Adjust-corners handler below for the incident this caused. */
  async function runServerClassify() {
    if (!visionSnapshot) { setServerMsg({ tone: "err", text: "Upload a board image first." }); return; }
    await runUltraScan(visionSnapshot.canvas);
  }
  /** "Ultra AI" — MIT YOLO extractor + 3-model classifier ensemble on the
   *  server. If we already have a tight client-warped board (from OpenCV.js
   *  detection), pass it in — the server will skip its extractor and use it.
   *  This fixes iPad screen photos where the server extractor over-reaches
   *  into UI chrome (title bar/bezel) and misaligns the 8×8 tile split.
   *  Latency ~1-3s. */
  async function runUltraScan(warped?: HTMLCanvasElement | string, rawDataUrlOverride?: string) {
    // rawDataUrlOverride lets runVision pass the raw synchronously (before
    // React state has propagated). Falls back to state for the manual button.
    const raw = rawDataUrlOverride || rawUploadDataUrl;
    if (!raw) { setServerMsg({ tone: "err", text: "Upload an image first." }); return; }
    // `warped` is either a client-side OpenCV.js canvas or a base64 PNG the
    // server already warped from the coach's four corners. Either way the
    // microservice skips its own extractor and trusts the crop we hand it.
    // Bypass serverBusy guard when we have a warp — that call is the
    // "reliable path" and should overwrite an earlier raw-only call still
    // in flight.
    if (serverBusy && !warped) return;
    // A fresh whole-image scan invalidates any previous page's board choices.
    if (!warped) setBoardChoices([]);
    setServerBusy(true);
    setServerMsg({
      tone: "info",
      text: warped
        ? "✨ Ultra AI (reliable): using your crop, skipping server extract…"
        : "✨ Ultra AI: extract + ensemble classify (1-3s)…",
    });
    try {
      const rawB64 = raw.replace(/^data:image\/[a-z]+;base64,/, "");
      const body: { rawImagePngBase64: string; warpedBoardPngBase64?: string } = { rawImagePngBase64: rawB64 };
      if (warped) {
        const warpedB64 = typeof warped === "string" ? warped : warped.toDataURL("image/png");
        body.warpedBoardPngBase64 = warpedB64.replace(/^data:image\/[a-z]+;base64,/, "");
        // Picking a board off the picker used to re-upload the ENTIRE page
        // alongside the crop — measured on a real coach page, 3.56 MB of raw
        // plus 2.87 MB of crop, a 6.4 MB POST from a phone. That is what
        // produced "Ultra AI failed: Load failed" on tap. The raw is only kept
        // for the scan log when a crop is supplied, and the first scan of this
        // very page already logged it, so send the crop alone.
        if (typeof warped === "string") body.rawImagePngBase64 = body.warpedBoardPngBase64;
      }
      const r = await fetch(`${API_BASE}/api/vision/classify-board-ultra`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Scanning now requires a session (it is a coach tool, and an open
      // inference endpoint can be farmed to copy the model). Say so plainly
      // instead of surfacing a raw 401 body.
      if (r.status === 401) throw new Error("Please sign in to scan a position — the scanner is for signed-in coaches and students.");
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // Warp-quality gate: if the server graded the crop "bad" (mis-aligned to
      // 8x8 grid, black-bar bleed, off-board scene, app screenshot with UI
      // chrome), skip populating the garbage FEN and auto-open the Adjust
      // Corners modal so the user can draw the board edges. The OpenCV freeze
      // that made us disable this earlier is fixed (pre-scale + no preload
      // + only-on-demand load).
      // More than one board on the page? Don't guess which one they meant.
      // The server only sends candidates when it found several at high
      // confidence, so reaching here means the choice is real.
      const cands = (j.candidates ?? []) as Array<{ index: number; confidence: number; boardPngBase64: string }>;
      const wq = j.warpQuality as { quality?: string; score?: number } | undefined;
      if (!warped && cands.length > 1) {
        setBoardChoices(cands);
        setServerMsg({
          tone: "info",
          text: `Found ${cands.length} boards on this page. Tap the position you want.`,
        });
        return;
      }
      // Our own crop is bad but the detector is sure it saw one board. That
      // detection is usually the answer the pipeline discarded — on a full book
      // page whose crop scored 0.013, the lone detection scored 0.934 and read
      // the printed position exactly. Retry with it rather than making the
      // coach draw corners. Safe from recursion: the retry passes a crop, and a
      // crop never comes back with candidates.
      if (!warped && cands.length === 1 && wq?.quality === "bad") {
        setServerMsg({ tone: "info", text: "Auto-crop looked wrong — retrying with the board we found…" });
        await runUltraScan(cands[0]!.boardPngBase64, raw);
        return;
      }
      if (wq?.quality === "bad") {
        setServerMsg({
          tone: "err",
          text: `Auto-crop looked wrong (score ${wq.score ?? 0}). Drag the 4 corners onto the true board edges, then tap Confirm.`,
        });
        setAdjusterOpen(true);
        return;
      }
      // The vision service returns the BOARD FIELD ONLY ("3rr2k/pppqn2p/...").
      // chess.js rejects a one-field FEN outright, so fp.load() was failing on
      // every scan and we told the coach "Position illegal — fix the misread
      // squares" even when all 64 squares were right. Verified 2026-09-09: a
      // scan that reproduced its book diagram exactly was reported illegal.
      // loadPermissive already retried with the missing fields appended, which
      // is why the board itself looked correct while the message contradicted
      // it. Normalise once, then both calls agree.
      const fullFen = normalizeScanFen(j.fen);
      const placed = fp.loadPermissive(fullFen);
      const legal = fp.load(fullFen);
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
          const cell = j.squares[r2]?.[c2];
          const conf = cell?.confidence ?? 1;
          // A square the model calls EMPTY needs a far lower score before it is
          // worth flagging. Measured across three real coach scans of
          // photographed book diagrams from different books:
          //
          //   low-confidence EMPTY squares:  0.431 0.485 0.529 0.570 0.649
          //                                  0.686 0.693  -- ALL were correct
          //   low-confidence PIECE squares:  0.549 0.566 0.579 0.622 0.659
          //                                  -- ALL were genuine errors
          //                                  (phantom pawns bled in from a
          //                                   coordinate strip in the crop)
          //
          // Hatched book print scores a blank square middlingly while still
          // getting it right, so a flat 0.7 bar cries wolf on every scan. 0.35
          // sits below the lowest correct empty seen (0.431) with headroom.
          //
          // Known residual risk: a genuinely MISSED piece — the model calling a
          // occupied square empty at low confidence — would now go unflagged.
          // No such case has appeared in these scans, but the sample is small,
          // so pieces keep the cautious bar and only empties were relaxed. The
          // better fix is a top-2 margin rather than a threshold, which needs
          // the service to return the runner-up class; see the roadmap.
          const limit = cell?.piece ? 0.7 : 0.35;
          if (conf < limit) {
            uncertain++;
            shapes.push({ orig: `${files[c2]}${8 - r2}`, brush: "yellow" });
          }
        }
      }
      setUncertainShapes(shapes);
      if (j.boardPngBase64) {
        setScanRef({ squares: j.squares, boardPngBase64: j.boardPngBase64, fen: fullFen });
        scanUploadedRef.current = "";
      }
      const uncertainTag = uncertain > 0 ? ` · ⚠ ${uncertain} uncertain` : "";
      // Missing-king guard. Every real chess position has both kings, and a
      // printed diagram always shows them. When a king is absent the read has
      // failed — most often because the crop included the a-h / 1-8 coordinate
      // labels, which shifts the 8x8 split by half a square so every piece is
      // sliced across two tiles and reads as a confident "empty" (TKT-166).
      // Deliberately NOT gated on warpQuality.parity: measured on real logged
      // crops, parity does not separate good reads from bad ones — a verified
      // 64/64 scan scored 0.641 while the broken TKT-166 crop scored 0.719.
      const board = j.fen.split(" ")[0];
      const missingKings = [
        board.includes("K") ? "" : "white",
        board.includes("k") ? "" : "black",
      ].filter(Boolean);
      // Piece-count sanity. Confidence cannot catch a CONFIDENTLY wrong read: a
      // coach scan on 2026-09-09 turned a black knight on b8 into a bishop at
      // 0.926, which no threshold would ever flag. But the resulting position
      // gave Black three rooks and three bishops, and that is visible for free.
      // A count above the starting complement needs promotions, which in a
      // diagram with most pawns still on the board is far less likely than a
      // misread piece. Warn, never block — promotions do happen.
      const excess: string[] = [];
      for (const [ch, max, plural] of [["R", 2, "rooks"], ["N", 2, "knights"],
                                       ["B", 2, "bishops"], ["Q", 1, "queens"]] as const) {
        for (const side of ["w", "b"] as const) {
          const sym = side === "w" ? ch : ch.toLowerCase();
          const n = board.split("").filter((x: string) => x === sym).length;
          if (n > max) excess.push(`${side === "w" ? "White" : "Black"} has ${n} ${plural}`);
        }
      }
      // The SERVER's logic engine also reports warnings — and knows things this
      // client-side count cannot, such as both bishops standing on the same
      // colour square, which is likewise only possible after a promotion. Those
      // were computed on every scan and thrown away here, so a position the
      // engine had already doubted was reported as clean.
      const serverWarn: string[] = Array.isArray(j.logicWarnings) ? j.logicWarnings : [];
      // Do not say the same thing twice: drop any server line already covered
      // by the piece-count check above.
      const extraWarn = serverWarn.filter(
        (w: string) => !excess.some((e) => w.includes(e)));
      const countWarn = excess.length || extraWarn.length
        ? ` ⚠ ${[...excess.map((e) => `${e} — at least one piece is misread`), ...extraWarn].join(" ")} Check those squares before using this position.`
        : "";
      const kingWarn = missingKings.length
        ? ` ⚠ No ${missingKings.join(" or ")} king found — the crop is probably off. Tap "Adjust corners" and put the handles on the corners of the 64 squares, inside the a-h and 1-8 labels.`
        : "";
      setServerMsg({
        tone: placed && !missingKings.length && !excess.length && !extraWarn.length ? "ok" : "err",
        text: placed
          ? (legal
              ? `✨ Ultra AI: ${pieceCount} pieces, avg conf ${avgConf}% (${timing}${uncertainTag}).${kingWarn}${countWarn}`
              : `✨ Ultra AI placed ${pieceCount} pieces (conf ${avgConf}%${uncertainTag}). Position illegal — fix the misread squares.${kingWarn}${countWarn}`)
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
  /** Upload every square the user changed after a scan.
   *
   *  Copying the FEN is the moment a coach says "this position is right now",
   *  which makes it the honest confirmation signal: whatever differs from the
   *  scan at that point is a correction they stand behind. Each one is sent
   *  with the square's own crop and with what the model had said, so training
   *  can weight it and a human can audit it. Fire-and-forget — a failed upload
   *  must never interrupt copying a FEN. */
  const captureCorrections = async () => {
    const ref = scanRef;
    if (!ref || scanUploadedRef.current === fp.fen) return;
    const board = fp.fen.split(" ")[0] ?? "";
    const scanned = ref.fen.split(" ")[0] ?? "";
    if (!board || board === scanned) return;      // nothing changed
    scanUploadedRef.current = fp.fen;
    try {
      const expand = (f: string) => {
        const out: (string | null)[] = [];
        for (const ch of f.replace(/\//g, "")) {
          if (ch >= "1" && ch <= "8") for (let i = 0; i < +ch; i++) out.push(null);
          else out.push(ch);
        }
        return out.length === 64 ? out : null;
      };
      const now = expand(board), was = expand(scanned);
      if (!now || !was) return;
      const canvas = await dataUrlToCanvas(`data:image/png;base64,${ref.boardPngBase64}`);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cell = canvas.width / 8;
      const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
      let sent = 0;
      for (let i = 0; i < 64; i++) {
        if (now[i] === was[i]) continue;
        const r = Math.floor(i / 8), c = i % 8;
        const ch = now[i];
        const color: "w" | "b" = ch && ch === ch.toUpperCase() ? "w" : "b";
        const piece = ch ? (ch.toUpperCase() as PieceType) : ("empty" as any);
        let silhouettePng: string;
        try {
          const sig = extractSilhouetteFromSquare(ctx, c * cell, r * cell, cell, cell, color, "print");
          silhouettePng = silhouetteToPngDataUrl(sig);
        } catch { continue; }
        const sq = ref.squares?.[r]?.[c];
        const crop = document.createElement("canvas");
        crop.width = crop.height = Math.round(cell);
        crop.getContext("2d")?.drawImage(canvas, c * cell, r * cell, cell, cell, 0, 0, crop.width, crop.height);
        void fetch(`${API_BASE}/api/vision/feedback`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: lastScanIdRef.current ?? undefined,
            piece, color, silhouettePng,
            rawCropPng: crop.toDataURL("image/png"),
            setHint: "scan-correction",
            square: `${files[c]}${8 - r}`,
            modelPiece: sq?.piece ? String(sq.piece) : "empty",
            modelConf: typeof sq?.confidence === "number" ? sq.confidence : undefined,
          }),
        }).catch(() => { /* never block the copy */ });
        sent++;
      }
      if (sent) setMsg(`FEN copied. ${sent} correction${sent > 1 ? "s" : ""} saved to improve the scanner.`);
    } catch { /* capture is best-effort */ }
  };

  const copyFen = () => {
    navigator.clipboard?.writeText(fp.fen);
    setMsg("FEN copied.");
    void captureCorrections();
    setTimeout(() => setMsg(""), 3000);
  };
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
          {returnTo && returnTo.startsWith("/") && (
            <button onClick={() => navigate(`${returnTo}${returnTo.includes("?") ? "&" : "?"}fen=${encodeURIComponent(editorFen ?? fp.fen)}`)}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"
              title="Set this position as the chapter's starting position">
              📓 Use in study →
            </button>
          )}
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
            Upload a screenshot or a photo of a diagram (Lichess / Chess.com / a book page). The scan reads every piece type, not just occupancy, and usually takes a few seconds. For a photo of a book, frame the 64 squares and leave the a-h / 1-8 labels outside the shot — including them shifts the grid and every piece is misread. Squares it is unsure about get a yellow ring. Drag pieces to fix anything wrong, then Copy FEN.
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
              {visionSnapshot && lastScanIdRef.current && (
                <button onClick={() => void confirmScan()} disabled={serverBusy || scanConfirmed}
                  title={visionMeta?.uncertain ? `Confirm after checking the ${visionMeta.uncertain} uncertain square${visionMeta.uncertain > 1 ? "s" : ""} (ringed)` : "Confirm the scan read the position correctly"}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                  {scanConfirmed ? "✓ Confirmed" : visionMeta?.uncertain ? `✓ Correct — checked ${visionMeta.uncertain} uncertain` : "✓ Position is correct"}
                </button>
              )}
              {visionSnapshot && (
                <button onClick={runServerClassify} disabled={serverBusy}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:cursor-wait disabled:bg-brand-800">
                  {serverBusy ? "🚀 Classifying…" : "🚀 Re-read my crop"}
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
              {boardChoices.length > 1 && (
                <div className="w-full">
                  <div className="mb-1 text-[11px] font-semibold text-ink-200">
                    {boardChoices.length} boards on this page — tap the one you want
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {boardChoices.map((c) => (
                      <button
                        key={c.index}
                        onClick={() => { setBoardChoices([]); void runUltraScan(c.boardPngBase64); }}
                        disabled={serverBusy}
                        title={`Board ${c.index + 1} · detector confidence ${(c.confidence * 100).toFixed(0)}%`}
                        className="group relative rounded-lg border border-ink-700 p-1 hover:border-brand-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        <img
                          src={`data:image/png;base64,${c.boardPngBase64}`}
                          alt={`Board ${c.index + 1}`}
                          className="h-20 w-20 rounded object-cover"
                        />
                        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white">
                          {c.index + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setBoardChoices([])}
                    className="mt-1 text-[10px] text-ink-500 underline hover:text-ink-300"
                  >
                    none of these — let me draw the corners
                  </button>
                </div>
              )}
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
                // Set preview, then classify through the SAME Ultra path the
                // auto scan uses, handing it the board the server just warped
                // from the coach's corners.
                //
                // This used to POST to /classify-board-v2, the old DINOv2-base
                // ONNX route that runs 64 sequential forwards INSIDE the API
                // process — ~26-31s of CPU in the same process that holds every
                // live class WebSocket. TKT-166 died on exactly that call.
                // classify-board-ultra proxies to the :5100 microservice
                // instead: out of process, ~1-3s, and it already accepts a
                // pre-warped board via warpedBoardPngBase64.
                setVisionPreview(`data:image/png;base64,${warpJ.boardPngBase64}`);
                await runUltraScan(String(warpJ.boardPngBase64), rawUploadDataUrl);
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
