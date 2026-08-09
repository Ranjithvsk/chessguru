// Phase 7n: full-screen celebration overlay when the user crosses a rating
// milestone. Pure CSS confetti (no dependency) — 60 pieces animate down with
// randomized colors/rotations/delays.
//
// Renders only when firstTime=true (i.e., the user just crossed this
// milestone for the first time ever). Re-crossings after a rating dip skip
// the celebration to avoid feeling hollow.

import { useEffect } from "react";

interface Props { milestone: number; type?: "rating" | "count"; onClose: () => void; }

const COLORS = ["#f97316", "#fbbf24", "#a855f7", "#22d3ee", "#34d399", "#f472b6", "#60a5fa"];

export default function MilestoneOverlay({ milestone, type = "rating", onClose }: Props) {
  const isCount = type === "count";
  const emoji = isCount ? "🏅" : "🎉";
  const kicker = isCount ? "Puzzles solved" : "Milestone unlocked";
  const sub = isCount
    ? <>You've solved <b>{milestone}</b> puzzles. That's real practice — keep it up.</>
    : <>Your puzzle rating just crossed <b>{milestone}</b>. Nicely done.</>;
  useEffect(() => {
    // Auto-dismiss after 6s so the overlay doesn't block interaction forever.
    const id = setTimeout(onClose, 6000);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") onClose(); };
    window.addEventListener("keydown", key);
    return () => { clearTimeout(id); window.removeEventListener("keydown", key); };
  }, [onClose]);

  // Deterministic-by-mount random for each confetti piece — jsx-inline for
  // simplicity (60 nodes is small enough that runtime cost is negligible).
  const pieces = Array.from({ length: 60 }, (_, i) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 0.6;
    const dur = 2.4 + Math.random() * 1.6;
    const rot = Math.floor(Math.random() * 360);
    const color = COLORS[i % COLORS.length];
    return { left, delay, dur, rot, color };
  });

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-label="Milestone celebration"
    >
      <style>{`
        @keyframes cg-confetti-fall {
          0%   { transform: translateY(-40px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(105vh) rotate(720deg); opacity: 0.85; }
        }
        @keyframes cg-pop {
          0%   { transform: scale(0.7); opacity: 0; }
          60%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {pieces.map((p, i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-0 h-2.5 w-2.5"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            transform: `rotate(${p.rot}deg)`,
            animation: `cg-confetti-fall ${p.dur}s linear ${p.delay}s forwards`,
            borderRadius: i % 3 === 0 ? "50%" : "2px",
          }}
        />
      ))}

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative mx-4 max-w-md rounded-2xl border border-brand-500/40 bg-gradient-to-br from-brand-600/20 via-purple-600/10 to-amber-500/10 p-8 text-center shadow-2xl"
        style={{ animation: "cg-pop 0.5s cubic-bezier(.2,.9,.3,1.2) forwards" }}
      >
        <div className="text-5xl">{emoji}</div>
        <div className="mt-3 text-sm font-semibold uppercase tracking-wide text-brand-300">{kicker}</div>
        <div className="mt-2 font-display text-6xl font-bold tabular-nums text-white">{milestone}</div>
        <div className="mt-2 text-sm text-ink-200">{sub}</div>
        <button
          onClick={onClose}
          className="mt-6 rounded-lg bg-gradient-to-r from-brand-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:brightness-110"
        >
          Keep going →
        </button>
      </div>
    </div>
  );
}
