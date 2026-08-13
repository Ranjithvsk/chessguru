// Coach-specific decorative primitives — extends the academy-public
// decorations with a few coach-flavoured extras (chess clock, calendar
// badge, opening card, signature scroll). Kept in its own file so the
// academy page isn't pulled in when someone lands on /coach/*.
//
// Everything here is pure SVG / CSS — no network, no state, tree-shakable.

import type { JSX } from "react";

/** Analog chess clock — pure SVG, ticks toward the black side. Used as the
 *  About-me visual anchor when a coach hasn't uploaded a custom photo. */
export function ChessClock({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 200 140" className={className} role="img" aria-label="Chess clock">
      <defs>
        <linearGradient id="clockBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
        <radialGradient id="clockFace" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#fde68a" />
        </radialGradient>
      </defs>
      {/* body */}
      <rect x="2" y="18" width="196" height="104" rx="14" fill="url(#clockBody)" />
      {/* two faces */}
      <circle cx="60" cy="70" r="38" fill="url(#clockFace)" stroke="#1e1b4b" strokeWidth="3" />
      <circle cx="140" cy="70" r="38" fill="url(#clockFace)" stroke="#1e1b4b" strokeWidth="3" />
      {/* left hands — 10:10 */}
      <line x1="60" y1="70" x2="60" y2="42" stroke="#1e1b4b" strokeWidth="3" strokeLinecap="round" />
      <line x1="60" y1="70" x2="82" y2="60" stroke="#1e1b4b" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="70" r="3" fill="#1e1b4b" />
      {/* right hands — 2:20 */}
      <line x1="140" y1="70" x2="160" y2="52" stroke="#1e1b4b" strokeWidth="3" strokeLinecap="round" />
      <line x1="140" y1="70" x2="128" y2="94" stroke="#1e1b4b" strokeWidth="3" strokeLinecap="round" />
      <circle cx="140" cy="70" r="3" fill="#1e1b4b" />
      {/* buttons */}
      <rect x="40" y="4" width="24" height="18" rx="4" fill="#f59e0b" />
      <rect x="136" y="4" width="24" height="18" rx="4" fill="#e11d48" />
      {/* base feet */}
      <rect x="16" y="122" width="30" height="10" rx="3" fill="#1e1b4b" />
      <rect x="154" y="122" width="30" height="10" rx="3" fill="#1e1b4b" />
    </svg>
  );
}

/** Small calendar-pin badge for upcoming class cards or as a decorative
 *  hook for the "Book a lesson" CTA. Colour comes from the tint prop. */
export function CalendarBadge({
  className = "",
  tint = "#10b981",
  label = "LIVE",
}: {
  className?: string; tint?: string; label?: string;
}): JSX.Element {
  return (
    <svg viewBox="0 0 60 70" className={className} role="img" aria-label="Calendar badge">
      <rect x="2" y="10" width="56" height="56" rx="8" fill="#fafaf9" stroke={tint} strokeWidth="3" />
      <rect x="2" y="10" width="56" height="16" fill={tint} />
      <line x1="14" y1="2" x2="14" y2="18" stroke={tint} strokeWidth="4" strokeLinecap="round" />
      <line x1="46" y1="2" x2="46" y2="18" stroke={tint} strokeWidth="4" strokeLinecap="round" />
      <text x="30" y="52" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="14" fill="#0f172a">
        {label}
      </text>
    </svg>
  );
}

/** Signature-opening card — shows the opening's name in fancy display type
 *  over a soft board tile. Used in the About section when a coach has a
 *  favourite / signature opening. Pure decoration; no live board. */
export function SignatureOpeningCard({
  name = "The Coach's Opening",
  moves = "1.e4 c5 2.Nf3",
  color = "White",
  className = "",
}: {
  name?: string; moves?: string; color?: string; className?: string;
}): JSX.Element {
  return (
    <div className={`relative rounded-3xl overflow-hidden shadow-2xl ring-4 ring-white ${className}`}>
      {/* board tile backdrop */}
      <div className="relative grid grid-cols-8 grid-rows-8 w-full aspect-square">
        {Array.from({ length: 64 }).map((_, i) => {
          const r = Math.floor(i / 8);
          const c = i % 8;
          const light = (r + c) % 2 === 0;
          return (
            <div key={i} className={light ? "bg-amber-50" : "bg-indigo-700"} />
          );
        })}
        {/* fade gradient for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-900/80 via-slate-900/40 to-transparent" />
      </div>
      <div className="absolute inset-0 flex flex-col justify-end p-6">
        <div className="inline-flex self-start items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400 text-slate-900 text-[10px] font-black tracking-wider mb-3">
          SIGNATURE OPENING
        </div>
        <h3 className="font-display text-white text-2xl md:text-3xl leading-tight drop-shadow-lg mb-1">{name}</h3>
        <div className="text-cyan-200 text-sm font-mono">{moves}</div>
        <div className="text-white/70 text-xs mt-2">Plays as {color}</div>
      </div>
    </div>
  );
}

/** Coach photo frame — decorative gradient ring, larger and more theatrical
 *  than the generic academy card avatars. Used in the hero. */
export function CoachPhotoFrame({
  src, name, size = 176, className = "",
}: {
  src?: string; name: string; size?: number; className?: string;
}): JSX.Element {
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <div className="absolute -inset-2 rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-cyan-400 blur-md opacity-70" />
      <div className="relative p-1 rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-cyan-400">
        <div className="p-1 rounded-full bg-white">
          {src ? (
            <img src={src} alt={name} className="rounded-full object-cover bg-slate-100" style={{ width: size - 16, height: size - 16 }} />
          ) : (
            <div
              className="rounded-full bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-700 grid place-items-center font-bold text-white"
              style={{ width: size - 16, height: size - 16, fontSize: size / 4 }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
