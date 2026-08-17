// Manual 4-corner adjuster for the vision pipeline. Shown when the coach
// hits "Adjust corners" after an auto-detected warp came out wrong (or
// pre-emptively). Renders the raw image on a canvas with 4 draggable
// handles at initial-guess positions (either from OpenCV auto-detect or
// evenly spread across the image). On Confirm, invokes onWarp with the
// user's corner coordinates so the parent can warp + re-classify.
//
// Works on both mouse and touch (phone) inputs.

import { useEffect, useRef, useState } from "react";

export interface Corner { x: number; y: number }

interface Props {
  imageSrc: string;           // data URL or path to the raw uploaded image
  initialCorners?: Corner[];  // 4 corners in [tl, tr, br, bl] order, in source-image coords
  onCancel: () => void;
  onConfirm: (corners: Corner[]) => void;
}

const HANDLE_R = 14;

export function CornerAdjuster({ imageSrc, initialCorners, onCancel, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [corners, setCorners] = useState<Corner[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);

  // Load image + set initial corners.
  useEffect(() => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      setImg(el);
      if (initialCorners && initialCorners.length === 4) {
        setCorners(initialCorners);
      } else {
        // Default: centred inset ~20% margin.
        const w = el.naturalWidth, h = el.naturalHeight;
        const mx = w * 0.2, my = h * 0.15;
        setCorners([
          { x: mx, y: my },
          { x: w - mx, y: my },
          { x: w - mx, y: h - my },
          { x: mx, y: h - my },
        ]);
      }
    };
    el.src = imageSrc;
  }, [imageSrc, initialCorners]);

  // Compute canvas display size (fit within viewport) + scale factor.
  const displayFit = (natW: number, natH: number): { w: number; h: number; scale: number } => {
    const maxW = Math.min(window.innerWidth - 32, 800);
    const maxH = Math.min(window.innerHeight - 200, 800);
    const scale = Math.min(maxW / natW, maxH / natH, 1);
    return { w: Math.round(natW * scale), h: Math.round(natH * scale), scale };
  };

  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const { w, h } = displayFit(img.naturalWidth, img.naturalHeight);
    const c = canvasRef.current;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    // Overlay a translucent quad connecting the 4 corners.
    const scale = w / img.naturalWidth;
    ctx.strokeStyle = "rgba(56,189,248,0.9)";
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(56,189,248,0.15)";
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const x = p.x * scale, y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Draw the 4 corner handles.
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const x = p.x * scale, y = p.y * scale;
      ctx.fillStyle = "#0ea5e9";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(["TL", "TR", "BR", "BL"][i]!, x, y);
    }
  }, [img, corners]);

  // Input handlers -- unified mouse + touch. Coords convert display → source.
  const posFromEvent = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0]!.clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0]!.clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  };
  const canvasToSrc = (p: { x: number; y: number }): Corner => {
    if (!img || !canvasRef.current) return p;
    const { scale } = displayFit(img.naturalWidth, img.naturalHeight);
    return { x: p.x / scale, y: p.y / scale };
  };
  const hitTest = (canvasPos: { x: number; y: number }): number | null => {
    if (!img) return null;
    const { scale } = displayFit(img.naturalWidth, img.naturalHeight);
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const dx = p.x * scale - canvasPos.x, dy = p.y * scale - canvasPos.y;
      if (dx * dx + dy * dy < (HANDLE_R + 6) * (HANDLE_R + 6)) return i;
    }
    return null;
  };
  const onDown = (e: React.MouseEvent | React.TouchEvent) => {
    const cp = posFromEvent(e);
    const idx = hitTest(cp);
    if (idx !== null) { setDragging(idx); e.preventDefault(); }
  };
  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (dragging === null) return;
    const cp = posFromEvent(e);
    const src = canvasToSrc(cp);
    setCorners((prev) => prev.map((p, i) => i === dragging ? src : p));
    e.preventDefault();
  };
  const onUp = () => setDragging(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start overflow-y-auto bg-black/85 p-4">
      <div className="mb-3 text-center text-sm text-white">
        <div className="font-semibold">Drag the 4 handles to the corners of the chess board</div>
        <div className="text-ink-300 text-xs mt-1">Then tap Confirm to re-classify</div>
      </div>
      {img && (
        <canvas
          ref={canvasRef}
          className="rounded-lg border border-brand-500/40 touch-none select-none"
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        />
      )}
      <div className="mt-4 flex gap-3">
        <button onClick={onCancel}
          className="rounded-lg border border-ink-600 bg-ink-800 px-4 py-2 text-sm font-semibold text-ink-200 hover:bg-ink-700">
          Cancel
        </button>
        <button onClick={() => onConfirm(corners)}
          disabled={!img}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50">
          ✓ Confirm & re-classify
        </button>
      </div>
    </div>
  );
}
