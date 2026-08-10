// /signup-academy — the front door for owner sign-ups.
//
// Everything above the form is marketing surface: animated aurora hero,
// stat marquee, sticky category tabs, per-category SVG illustrations, big
// pricing card, FAQ, and a sticky top-bar CTA that appears once you've
// scrolled past the hero. The form itself is unchanged in behavior.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEATURES, FEATURES_BY_CATEGORY, CATEGORY_META,
  type FeatureCategory, type Feature,
} from "../lib/features";

type FieldErr = string | null;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

interface Announcement {
  id: string; title: string; body: string;
  ctaLabel: string | null; ctaUrl: string | null;
  category: string | null; emoji: string | null;
  publishedAt: string;
}

const CATEGORY_ORDER: FeatureCategory[] = [
  "puzzles", "classes", "academy", "analytics", "study", "engagement", "notifications", "play",
];

// ────────────────────────────────────────────────────────────────────
// Rich SVG illustrations per category. Better than a plain gradient
// tile — hints at what the feature does without needing a real photo.
// All ~800×533 so they fill the 3:2 card area at every screen size.
// ────────────────────────────────────────────────────────────────────

function ChessBoardMini({ variant = "puzzle" as "puzzle" | "arrow" | "annotate" }) {
  // A tiny 8×8 board with themed accents. Cheap and universally recognizable.
  const dark = "#7c5c3e", light = "#f2d9b5";
  const pieces = variant === "puzzle"
    ? [{ f: 4, r: 2, g: "♚" }, { f: 3, r: 5, g: "♞" }, { f: 5, r: 5, g: "♛" }, { f: 4, r: 6, g: "♔" }]
    : variant === "annotate"
      ? [{ f: 3, r: 3, g: "♗" }, { f: 5, r: 5, g: "♝" }, { f: 2, r: 6, g: "♔" }, { f: 4, r: 1, g: "♛" }]
      : [{ f: 4, r: 4, g: "♞" }, { f: 6, r: 6, g: "♚" }];
  return (
    <svg viewBox="0 0 320 320" className="h-full w-full">
      {Array.from({ length: 8 }).map((_, r) => Array.from({ length: 8 }).map((_, f) => (
        <rect key={`${r}-${f}`} x={f * 40} y={r * 40} width={40} height={40} fill={(r + f) % 2 === 0 ? light : dark} />
      )))}
      {pieces.map((p, i) => (
        <text key={i} x={p.f * 40 + 20} y={p.r * 40 + 32} textAnchor="middle" fontSize="34" fill="#111">{p.g}</text>
      ))}
      {variant === "arrow" && (
        <>
          <defs><marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#10b981" /></marker></defs>
          <line x1="180" y1="180" x2="260" y2="260" stroke="#10b981" strokeWidth="8" strokeLinecap="round" markerEnd="url(#ar)" opacity="0.85" />
        </>
      )}
      {variant === "annotate" && (
        <>
          <circle cx="140" cy="140" r="14" fill="none" stroke="#e11d48" strokeWidth="4" />
          <defs><marker id="ag" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#10b981" /></marker></defs>
          <line x1="100" y1="260" x2="180" y2="180" stroke="#10b981" strokeWidth="7" markerEnd="url(#ag)" opacity="0.85" />
        </>
      )}
    </svg>
  );
}

function VideoCallMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <defs>
        <linearGradient id="vc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0f172a" /><stop offset="1" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <rect width="800" height="533" fill="url(#vc)" />
      {/* Main video */}
      <rect x="40" y="40" width="460" height="360" rx="14" fill="#111827" />
      <circle cx="270" cy="200" r="50" fill="#f472b6" opacity="0.9" />
      <text x="270" y="215" textAnchor="middle" fontSize="42" fill="#fff">🎥</text>
      <rect x="60" y="360" width="180" height="26" rx="6" fill="#f43f5e" opacity="0.9" />
      <text x="76" y="378" fontSize="14" fill="#fff" fontFamily="system-ui" fontWeight="600">Coach Meera · LIVE</text>
      {/* Side thumbnails */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="520" y={40 + i * 130} width="240" height="110" rx="10" fill="#374151" />
          <circle cx="560" cy={95 + i * 130} r="18" fill={["#22d3ee","#a855f7","#fbbf24"][i]} />
          <text x={590} y={95 + i * 130 + 5} fontSize="12" fill="#e5e7eb" fontFamily="system-ui">Student {i + 1}</text>
          <text x={590} y={95 + i * 130 + 22} fontSize="10" fill="#9ca3af" fontFamily="system-ui">🎤 unmuted</text>
        </g>
      ))}
      {/* Board */}
      <rect x="40" y="420" width="460" height="90" rx="10" fill="#1f2937" />
      {Array.from({ length: 8 }).map((_, f) => (
        <rect key={f} x={60 + f * 46} y="435" width="40" height="60" fill={f % 2 ? "#7c5c3e" : "#f2d9b5"} />
      ))}
      <text x="80" y="475" fontSize="24">♞</text>
      <text x="310" y="475" fontSize="24">♚</text>
    </svg>
  );
}

function RosterMock() {
  const rows = [
    { name: "Anika Rao",    rating: 1612, streak: 12 },
    { name: "Karthik M.",   rating: 1489, streak: 5  },
    { name: "Zara Ahmed",   rating: 1701, streak: 21 },
    { name: "Rohan Iyer",   rating: 1355, streak: 3  },
    { name: "Priya Kumar",  rating: 1550, streak: 8  },
  ];
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <rect width="800" height="533" fill="#0f172a" />
      <rect x="40" y="40" width="720" height="60" rx="12" fill="#1e293b" />
      <text x="60" y="78" fontSize="18" fill="#fbbf24" fontFamily="system-ui" fontWeight="700">👦 My students</text>
      <text x="720" y="76" textAnchor="end" fontSize="13" fill="#94a3b8" fontFamily="system-ui">5 active</text>
      {rows.map((r, i) => (
        <g key={i}>
          <rect x="40" y={120 + i * 74} width="720" height="60" rx="10" fill={i % 2 ? "#111827" : "#1e293b"} />
          <circle cx="76" cy={150 + i * 74} r="18" fill={["#a855f7","#22d3ee","#f472b6","#10b981","#fbbf24"][i]} />
          <text x="112" y={148 + i * 74} fontSize="15" fill="#fff" fontFamily="system-ui" fontWeight="600">{r.name}</text>
          <text x="112" y={165 + i * 74} fontSize="11" fill="#94a3b8" fontFamily="system-ui">Rating {r.rating}</text>
          <text x="500" y={155 + i * 74} fontSize="13" fill="#f97316" fontFamily="system-ui">🔥 {r.streak}-day</text>
          <text x="640" y={155 + i * 74} fontSize="13" fill="#10b981" fontFamily="system-ui">✓ paid</text>
        </g>
      ))}
    </svg>
  );
}

function ChartMock() {
  const bars = [45, 62, 38, 88, 71, 95, 54, 82, 66, 91, 73, 100, 88, 76];
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a855f7" /><stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="800" height="533" fill="#0f172a" />
      <text x="40" y="70" fontSize="20" fill="#e5e7eb" fontFamily="system-ui" fontWeight="700">📊 Rating over time</text>
      <text x="40" y="95" fontSize="13" fill="#94a3b8" fontFamily="system-ui">Last 14 days</text>
      {bars.map((h, i) => (
        <rect key={i} x={60 + i * 50} y={430 - h * 3.2} width={34} height={h * 3.2} rx="4" fill="url(#bg)" opacity={0.7 + (i / bars.length) * 0.3} />
      ))}
      {/* Trend line */}
      <polyline points={bars.map((h, i) => `${60 + i * 50 + 17},${430 - h * 3.2}`).join(" ")} fill="none" stroke="#fbbf24" strokeWidth="3" />
      {bars.map((h, i) => <circle key={i} cx={60 + i * 50 + 17} cy={430 - h * 3.2} r="4" fill="#fbbf24" />)}
      <text x="40" y="500" fontSize="11" fill="#64748b" fontFamily="system-ui">+124 rating gained</text>
    </svg>
  );
}

function BookMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <rect width="800" height="533" fill="#0f172a" />
      <rect x="80" y="60" width="640" height="420" rx="16" fill="#1e293b" />
      <rect x="80" y="60" width="640" height="60" rx="16" fill="#059669" />
      <text x="110" y="98" fontSize="20" fill="#fff" fontFamily="system-ui" fontWeight="700">📕 Sicilian Defense</text>
      <text x="700" y="98" textAnchor="end" fontSize="14" fill="#a7f3d0" fontFamily="system-ui">Chapter 3 · Najdorf</text>
      <text x="110" y="160" fontSize="14" fill="#94a3b8" fontFamily="system-ui" fontWeight="700">MOVE 6</text>
      <text x="110" y="200" fontSize="28" fill="#fff" fontFamily="system-ui" fontWeight="700">6. Be3 e5 <tspan fill="#fbbf24">7. Nb3</tspan></text>
      <text x="110" y="240" fontSize="14" fill="#cbd5e1" fontFamily="system-ui">The English Attack. White plans f3, Qd2, and long castle.</text>
      <rect x="110" y="290" width="580" height="80" rx="10" fill="#111827" />
      <text x="130" y="330" fontSize="14" fill="#a5b4fc" fontFamily="system-ui">▶ Play through against Maia — the engine will pick the natural human reply.</text>
      <rect x="110" y="400" width="200" height="44" rx="8" fill="#7c3aed" />
      <text x="210" y="428" textAnchor="middle" fontSize="15" fill="#fff" fontFamily="system-ui" fontWeight="600">Start drill</text>
    </svg>
  );
}

function MilestoneMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <defs>
        <radialGradient id="rg" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#7c3aed" stopOpacity="0.4" />
          <stop offset="1" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <rect width="800" height="533" fill="url(#rg)" />
      {/* Confetti */}
      {[["#f97316",120,80],["#fbbf24",200,180],["#a855f7",260,60],["#22d3ee",640,90],["#10b981",700,200],["#f472b6",560,50],["#60a5fa",120,300],["#fbbf24",680,320],["#a855f7",100,420],["#22d3ee",720,420]].map((c, i) => (
        <rect key={i} x={c[1] as number} y={c[2] as number} width="10" height="10" fill={c[0] as string} transform={`rotate(${i * 37} ${c[1]} ${c[2]})`} />
      ))}
      <text x="400" y="220" textAnchor="middle" fontSize="90">🎉</text>
      <text x="400" y="290" textAnchor="middle" fontSize="18" fill="#a5b4fc" fontFamily="system-ui" fontWeight="700" letterSpacing="4">MILESTONE UNLOCKED</text>
      <text x="400" y="380" textAnchor="middle" fontSize="72" fill="#fff" fontFamily="system-ui" fontWeight="800">1500</text>
      <text x="400" y="440" textAnchor="middle" fontSize="16" fill="#cbd5e1" fontFamily="system-ui">Rating just crossed 1500</text>
    </svg>
  );
}

function NotificationMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <defs>
        <linearGradient id="ng" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f97316" /><stop offset="1" stopColor="#e11d48" />
        </linearGradient>
      </defs>
      <rect width="800" height="533" fill="#0f172a" />
      {/* Push toast */}
      <rect x="80" y="80" width="640" height="120" rx="14" fill="#1f2937" stroke="#334155" />
      <rect x="80" y="80" width="6" height="120" rx="3" fill="url(#ng)" />
      <text x="120" y="110" fontSize="14" fill="#94a3b8" fontFamily="system-ui" fontWeight="600">CHESSGURU · now</text>
      <text x="120" y="150" fontSize="22" fill="#fff" fontFamily="system-ui" fontWeight="700">🔥 Your 5-day streak is at risk</text>
      <text x="120" y="178" fontSize="14" fill="#cbd5e1" fontFamily="system-ui">One quick puzzle keeps it alive.</text>
      {/* Weekly digest email */}
      <rect x="80" y="240" width="640" height="240" rx="14" fill="#1f2937" />
      <rect x="80" y="240" width="640" height="60" rx="14" fill="#7c3aed" />
      <text x="120" y="278" fontSize="18" fill="#fff" fontFamily="system-ui" fontWeight="700">📊 Your ChessGuru week</text>
      <rect x="120" y="320" width="280" height="60" rx="8" fill="#374151" />
      <text x="140" y="345" fontSize="12" fill="#94a3b8" fontFamily="system-ui">SOLVES</text>
      <text x="140" y="370" fontSize="24" fill="#fff" fontFamily="system-ui" fontWeight="700">37 · 84% acc</text>
      <rect x="420" y="320" width="280" height="60" rx="8" fill="#374151" />
      <text x="440" y="345" fontSize="12" fill="#94a3b8" fontFamily="system-ui">RATING</text>
      <text x="440" y="370" fontSize="24" fill="#10b981" fontFamily="system-ui" fontWeight="700">+52</text>
      <rect x="120" y="410" width="200" height="40" rx="8" fill="#7c3aed" />
      <text x="220" y="437" textAnchor="middle" fontSize="14" fill="#fff" fontFamily="system-ui" fontWeight="600">Open dashboard</text>
    </svg>
  );
}

function HeatmapMock() {
  const days = Array.from({ length: 91 }, (_, i) => Math.min(4, Math.floor(Math.sin(i * 0.4) * 2 + Math.random() * 3 + 1)));
  const shade = (v: number) => v === 0 ? "#1e293b" : v === 1 ? "#065f46" : v === 2 ? "#059669" : v === 3 ? "#10b981" : "#34d399";
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <rect width="800" height="533" fill="#0f172a" />
      <text x="40" y="70" fontSize="20" fill="#e5e7eb" fontFamily="system-ui" fontWeight="700">🟩 Activity heatmap</text>
      <text x="40" y="95" fontSize="13" fill="#94a3b8" fontFamily="system-ui">Last 13 weeks</text>
      {days.map((v, i) => {
        const col = Math.floor(i / 7), row = i % 7;
        return <rect key={i} x={60 + col * 22} y={130 + row * 22} width="18" height="18" rx="3" fill={shade(v)} />;
      })}
      <text x="40" y="450" fontSize="13" fill="#94a3b8" fontFamily="system-ui">🔥 Current streak: 12 days</text>
      <text x="40" y="475" fontSize="13" fill="#94a3b8" fontFamily="system-ui">🏆 Longest: 34 days</text>
    </svg>
  );
}

function BadgeMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <defs>
        <radialGradient id="brg" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f97316" stopOpacity="0.5" />
          <stop offset="1" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <rect width="800" height="533" fill="url(#brg)" />
      <text x="400" y="180" textAnchor="middle" fontSize="120">🔥</text>
      <text x="400" y="290" textAnchor="middle" fontSize="80" fill="#fff" fontFamily="system-ui" fontWeight="800">12</text>
      <text x="400" y="330" textAnchor="middle" fontSize="16" fill="#fdba74" fontFamily="system-ui">DAY STREAK</text>
      <g transform="translate(210 400)">
        {[true, true, true, true, true, false, false].map((on, i) => (
          <rect key={i} x={i * 55} y="0" width="45" height="45" rx="8" fill={on ? "#10b981" : "#374151"} />
        ))}
        {[true, true, true, true, true, false, false].map((on, i) => (
          <text key={i} x={i * 55 + 22} y="30" textAnchor="middle" fontSize="20" fill="#fff">{on ? "✓" : "—"}</text>
        ))}
      </g>
    </svg>
  );
}

function PlayMock() {
  return (
    <svg viewBox="0 0 800 533" className="h-full w-full">
      <rect width="800" height="533" fill="#0f172a" />
      {/* Board */}
      <g transform="translate(200 40)">
        {Array.from({ length: 8 }).map((_, r) => Array.from({ length: 8 }).map((_, f) => (
          <rect key={`${r}-${f}`} x={f * 55} y={r * 55} width={55} height={55} fill={(r + f) % 2 ? "#7c5c3e" : "#f2d9b5"} />
        )))}
        <text x="45" y="50" fontSize="42">♜</text>
        <text x="220" y="105" fontSize="42">♞</text>
        <text x="330" y="270" fontSize="42">♛</text>
        <text x="165" y="435" fontSize="42">♔</text>
      </g>
      <rect x="60" y="220" width="120" height="60" rx="10" fill="#374151" />
      <text x="120" y="260" textAnchor="middle" fontSize="24">🎮</text>
      <rect x="620" y="220" width="120" height="60" rx="10" fill="#374151" />
      <text x="680" y="260" textAnchor="middle" fontSize="24">🎮</text>
    </svg>
  );
}

function illustrationFor(f: Feature): JSX.Element {
  // Map each category (and a few specific IDs) to its illustration.
  switch (f.id) {
    case "puzzle-of-the-day":    return <ChessBoardMini variant="puzzle" />;
    case "wrong-move-analysis":  return <ChessBoardMini variant="annotate" />;
    case "puzzle-trainer":       return <ChessBoardMini variant="arrow" />;
    case "board-annotations":    return <ChessBoardMini variant="annotate" />;
    case "snap-position":        return <ChessBoardMini variant="annotate" />;
    case "board-editor":         return <ChessBoardMini variant="arrow" />;
    default: break;
  }
  switch (f.category) {
    case "puzzles":       return <ChessBoardMini variant="arrow" />;
    case "classes":       return <VideoCallMock />;
    case "academy":       return <RosterMock />;
    case "analytics":     return f.id === "heatmap" ? <HeatmapMock /> : <ChartMock />;
    case "study":         return <BookMock />;
    case "engagement":    return f.id.includes("milestone") ? <MilestoneMock /> : <BadgeMock />;
    case "notifications": return <NotificationMock />;
    case "play":          return <PlayMock />;
  }
}

function FeatureShot({ f }: { f: Feature }) {
  // Prefer a real screenshot when one has been dropped into
  // public/feature-shots/<id>.png. Otherwise show the category-appropriate
  // SVG illustration — much richer than a solid gradient.
  const [failed, setFailed] = useState(false);
  const src = `/feature-shots/${f.id}.png`;
  return (
    <div className={`relative aspect-[3/2] w-full overflow-hidden rounded-t-xl2 bg-gradient-to-br ${CATEGORY_META[f.category].gradient}`}>
      {failed ? (
        <div className="absolute inset-0">{illustrationFor(f)}</div>
      ) : (
        <img
          src={src} alt={f.title}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)} loading="lazy"
        />
      )}
    </div>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-ink-900/80 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-brand-500/40 hover:shadow-brand-500/20">
      {/* Animated gradient border on hover */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
           style={{ background: "linear-gradient(135deg, rgba(124,58,237,.15), rgba(236,72,153,.15), rgba(251,191,36,.15))" }} />
      <FeatureShot f={f} />
      <div className="relative flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{f.emoji}</span>
            <h3 className="font-display text-sm font-semibold text-white">{f.title}</h3>
          </div>
          {f.badge && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              f.badge === "NEW" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40" : "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40"
            }`}>{f.badge}</span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{f.description}</p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Interactive category filter — pills at the top. "All" shows the
// grouped-by-category view; picking one filters to just that category.
// ────────────────────────────────────────────────────────────────────
function CategoryFilter({ value, onChange, counts }: {
  value: FeatureCategory | "all";
  onChange: (v: FeatureCategory | "all") => void;
  counts: Record<FeatureCategory | "all", number>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => onChange("all")}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
          value === "all"
            ? "bg-white text-ink-900 shadow-lg"
            : "bg-ink-800/60 text-ink-300 hover:bg-ink-700 hover:text-white"
        }`}>
        Everything <span className="ml-1 text-xs opacity-60">{counts.all}</span>
      </button>
      {CATEGORY_ORDER.map((c) => (
        <button key={c} onClick={() => onChange(c)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            value === c
              ? "bg-gradient-to-r from-brand-500 to-purple-500 text-white shadow-lg"
              : "bg-ink-800/60 text-ink-300 hover:bg-ink-700 hover:text-white"
          }`}>
          {CATEGORY_META[c].label} <span className="ml-1 text-xs opacity-60">{counts[c]}</span>
        </button>
      ))}
    </div>
  );
}

function WhatsNewStrip({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-3xl border border-brand-500/30 bg-gradient-to-r from-brand-600/15 via-purple-500/10 to-transparent p-5 backdrop-blur">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-xl text-white">✨ What's new</h2>
        <span className="text-xs text-ink-500">last {items.length} update{items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {items.slice(0, 3).map((a) => (
          <div key={a.id} className="group rounded-xl border border-ink-700 bg-ink-900 p-4 transition hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-lg">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <span className="text-2xl transition-transform group-hover:scale-110">{a.emoji || "✨"}</span>
              <span>{a.title}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-xs text-ink-400">{a.body}</p>
            <div className="mt-3 text-[10px] uppercase tracking-wide text-ink-500">
              {new Date(a.publishedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-amber-500/40 shadow-2xl">
      {/* Aurora background */}
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-brand-500/20" />
      <div className="absolute inset-0 opacity-40" style={{
        backgroundImage: "radial-gradient(circle at 15% 20%, rgba(251,191,36,.25), transparent 40%), radial-gradient(circle at 85% 80%, rgba(147,51,234,.3), transparent 40%)",
      }} />
      <div className={`relative grid gap-6 p-8 ${compact ? "md:grid-cols-[2fr_1fr]" : "md:grid-cols-2"}`}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-300">Simple, honest pricing</div>
          <div className="mt-2 flex items-baseline gap-3 font-display">
            <span className="text-6xl font-bold text-white">₹1,000</span>
            <span className="text-lg text-ink-300">/ month</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-500/25 px-3 py-1 font-semibold text-emerald-200 ring-1 ring-emerald-400/40">🎁 First 3 months free</span>
          </div>
          <p className="mt-3 text-sm text-ink-300 max-w-md">
            Try every feature with your whole academy for 90 days. No credit card up front.
            Cancel anytime — your data comes with you.
          </p>
          <a href="#signup" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 px-6 py-3 text-sm font-bold text-white shadow-xl transition hover:brightness-110 hover:scale-[1.02]">
            Start free trial <span className="text-lg">→</span>
          </a>
        </div>
        <ul className="grid gap-2 self-center text-sm">
          {[
            "Unlimited coaches",
            "Unlimited students",
            "Unlimited classes + recordings",
            "Every ChessGuru feature",
            "Custom academy branding",
            "Cancel anytime",
          ].map((line) => (
            <li key={line} className="flex items-center gap-2 text-ink-100">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500/20 text-emerald-300">✓</span>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    { q: "Do I need a credit card to start?",
      a: "No. The 90-day trial is free — sign up with just an email. If you decide to continue, you'll get a payment link via email before the trial ends." },
    { q: "Is there really no student cap?",
      a: "Yes. Unlimited students, unlimited coaches, unlimited classes. The ₹1,000/month is a flat academy fee, not per-seat." },
    { q: "What does the trial include?",
      a: "Everything. Every feature on this page — puzzles, live video classes, analytics, engagement loops, all of it." },
    { q: "Can students access ChessGuru without an academy?",
      a: "Yes. Puzzles, study modes, and their own performance dashboard are free for everyone. The academy tier adds coach management, live classes, and roll-up analytics for the school." },
    { q: "Where's my data if I cancel?",
      a: "You can export student histories and class recordings any time. If you cancel, we keep your data intact for 60 days in case you come back." },
    { q: "Do you send too many emails?",
      a: "No — every email channel has a one-click unsubscribe and per-user dashboard toggles. We also send at most one weekly digest + at most one evening streak reminder." },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="space-y-2">
      <h2 className="font-display text-2xl text-white">Frequently asked</h2>
      <div className="divide-y divide-ink-800 overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">
        {items.map((it, i) => (
          <div key={i}>
            <button onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-ink-800/50">
              <span className="text-sm font-medium text-white">{it.q}</span>
              <span className={`text-lg text-ink-400 transition-transform ${open === i ? "rotate-45" : ""}`}>+</span>
            </button>
            {open === i && (
              <div className="px-5 pb-4 text-sm leading-relaxed text-ink-300">{it.a}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sticky top CTA — slides in once the user has scrolled past the hero.
// Keeps "start free trial" always one tap away.
// ────────────────────────────────────────────────────────────────────
function StickyCTA() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 500);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className={`fixed top-14 left-0 right-0 z-40 border-b border-brand-500/30 bg-ink-900/95 backdrop-blur transition-transform duration-300 ${show ? "translate-y-0" : "-translate-y-full"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-lg">🏛️</span>
          <span className="hidden font-semibold text-white sm:inline">ChessGuru Academy</span>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">3 months free</span>
        </div>
        <a href="#signup" className="rounded-lg bg-gradient-to-r from-brand-500 to-purple-500 px-4 py-1.5 text-sm font-semibold text-white shadow hover:brightness-110">
          Start free trial →
        </a>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Aurora background — soft animated color washes behind the whole page.
// ────────────────────────────────────────────────────────────────────
function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <style>{`
        @keyframes cg-aurora-1 { 0%,100% { transform: translate(-15%, -10%) rotate(0deg); } 50% { transform: translate(15%, 5%) rotate(30deg); } }
        @keyframes cg-aurora-2 { 0%,100% { transform: translate(20%, 30%) rotate(0deg); } 50% { transform: translate(-10%, -15%) rotate(-30deg); } }
        @keyframes cg-aurora-3 { 0%,100% { transform: translate(0%, 0%) scale(1); } 50% { transform: translate(0%, 5%) scale(1.15); } }
        @keyframes cg-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
      `}</style>
      <div className="absolute -top-32 -left-40 h-[600px] w-[600px] rounded-full bg-brand-600/30 blur-[120px]" style={{ animation: "cg-aurora-1 18s ease-in-out infinite" }} />
      <div className="absolute top-40 -right-40 h-[500px] w-[500px] rounded-full bg-purple-600/25 blur-[120px]" style={{ animation: "cg-aurora-2 22s ease-in-out infinite" }} />
      <div className="absolute bottom-0 left-1/3 h-[500px] w-[500px] rounded-full bg-amber-500/20 blur-[120px]" style={{ animation: "cg-aurora-3 25s ease-in-out infinite" }} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────

export default function SignupAcademyPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [academyName, setAcademyName] = useState("");
  const [ownerEmail,  setOwnerEmail]  = useState("");
  const [password,    setPassword]    = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<FieldErr>(null);
  const [filter, setFilter] = useState<FeatureCategory | "all">("all");

  const { data: announcements } = useQuery({
    queryKey: ["announcements"], queryFn: () => get<Announcement[]>("/api/announcements?limit=5"),
    staleTime: 5 * 60_000,
  });

  const counts: Record<FeatureCategory | "all", number> = {
    all: FEATURES.length,
    puzzles: FEATURES_BY_CATEGORY.puzzles.length,
    study: FEATURES_BY_CATEGORY.study.length,
    play: FEATURES_BY_CATEGORY.play.length,
    classes: FEATURES_BY_CATEGORY.classes.length,
    academy: FEATURES_BY_CATEGORY.academy.length,
    analytics: FEATURES_BY_CATEGORY.analytics.length,
    notifications: FEATURES_BY_CATEGORY.notifications.length,
    engagement: FEATURES_BY_CATEGORY.engagement.length,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // Username auto-derived from email server-side — see AuthService.signupAcademy.
      const r = await post<{ ok: boolean; error?: string; academyName?: string }>("/auth/signup-academy",
        { academyName, ownerEmail, password });
      if (!r.ok) { setErr(r.error || "Signup failed."); return; }
      qc.removeQueries();
      window.location.href = "/academy";
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-14 py-6">
      <AuroraBackground />
      <StickyCTA />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/40 p-8 shadow-2xl backdrop-blur md:p-14">
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-300">
            🎁 90-day free trial · No card
          </div>
          <h1 className="mt-5 font-display text-5xl font-bold leading-tight text-white md:text-6xl">
            Run your chess academy on{" "}
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-brand-300 via-purple-300 to-amber-300 bg-clip-text text-transparent">ChessGuru</span>
              <span className="absolute -bottom-1 left-0 right-0 h-1 rounded-full bg-gradient-to-r from-brand-500 via-purple-500 to-amber-500 opacity-60" />
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-200">
            Every tool you need to teach, coach, and grow — puzzles, study, live video classes, per-student
            analytics, fees + attendance, and a delight-loop of streaks and celebrations that keeps students
            coming back.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href="#signup" className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 via-purple-500 to-pink-500 px-7 py-3.5 text-base font-semibold text-white shadow-xl transition hover:brightness-110 hover:scale-[1.02]">
              Start free trial <span className="text-lg">→</span>
            </a>
            <a href="#features" className="rounded-xl border border-white/15 bg-white/5 px-7 py-3.5 text-base text-white backdrop-blur transition hover:bg-white/10">
              Explore features
            </a>
          </div>

          {/* Stat row */}
          <div className="mt-10 grid gap-4 sm:grid-cols-4">
            {[
              ["35+", "features", "🧩"],
              ["Unlimited", "students", "👦"],
              ["Unlimited", "coaches", "👨‍🏫"],
              ["₹1,000/mo", "after trial", "💳"],
            ].map(([n, l, e], i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 backdrop-blur">
                <div className="text-2xl">{e}</div>
                <div className="mt-1 font-display text-xl font-bold text-white">{n}</div>
                <div className="text-xs text-ink-400">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What's new ─────────────────────────────────────────── */}
      {announcements && announcements.length > 0 && <WhatsNewStrip items={announcements} />}

      {/* ── Features ───────────────────────────────────────────── */}
      <section id="features" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl text-white">Everything included</h2>
            <p className="text-sm text-ink-400">All 35+ features are yours from day one — no add-ons, no upsells.</p>
          </div>
        </div>
        <div className="sticky top-14 z-30 -mx-2 rounded-2xl bg-ink-950/85 p-3 backdrop-blur">
          <CategoryFilter value={filter} onChange={setFilter} counts={counts} />
        </div>

        {filter === "all" ? (
          <div className="space-y-10">
            {CATEGORY_ORDER.map((cat) => {
              const items = FEATURES_BY_CATEGORY[cat];
              if (items.length === 0) return null;
              return (
                <div key={cat} className="space-y-3">
                  <header className="flex items-baseline justify-between">
                    <div>
                      <h3 className="font-display text-xl text-white">{CATEGORY_META[cat].label}</h3>
                      <p className="text-sm text-ink-400">{CATEGORY_META[cat].blurb}</p>
                    </div>
                    <button onClick={() => setFilter(cat)}
                      className="text-xs text-brand-300 hover:underline">See all {items.length} →</button>
                  </header>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((f) => <FeatureCard key={f.id} f={f} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            <header className="mb-3">
              <h3 className="font-display text-xl text-white">{CATEGORY_META[filter].label}</h3>
              <p className="text-sm text-ink-400">{CATEGORY_META[filter].blurb}</p>
            </header>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES_BY_CATEGORY[filter].map((f) => <FeatureCard key={f.id} f={f} />)}
            </div>
          </div>
        )}
      </section>

      {/* ── Pricing ─────────────────────────────────────────────── */}
      <PricingCard />

      {/* ── FAQ ────────────────────────────────────────────────── */}
      <FAQ />

      {/* ── Signup form ────────────────────────────────────────── */}
      <section id="signup" className="mx-auto max-w-lg scroll-mt-24">
        <div className="rounded-3xl border border-brand-500/30 bg-gradient-to-br from-ink-900 via-ink-900 to-brand-900/20 p-7 shadow-2xl backdrop-blur">
          <div className="mb-1 text-3xl">🏛️</div>
          <h1 className="mb-1 font-display text-3xl text-white">Create your Academy</h1>
          <p className="mb-6 text-sm text-ink-300">
            You'll be up and running in under a minute. <b className="text-emerald-300">Free for 90 days</b> — no card required.
          </p>

          {err && (
            <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Academy name</label>
              <input required value={academyName} onChange={(e) => setAcademyName(e.target.value)}
                placeholder="Stephens Chess Academy"
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Your email</label>
              <input required type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="you@yourschool.com"
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              <p className="mt-1 text-[11px] text-ink-500">You'll sign in with this. Also used for password reset + trial + feature updates.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Password</label>
              <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2.5 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>

            <button disabled={busy} type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-brand-500 via-purple-500 to-pink-500 py-3.5 text-base font-bold text-white shadow-xl transition hover:brightness-110 hover:scale-[1.01] disabled:opacity-50">
              {busy ? "Creating…" : "Start your 90-day trial →"}
            </button>
          </form>

          <div className="mt-6 border-t border-ink-800 pt-4 text-center text-sm text-ink-400">
            Already have an account? <Link to="/login" className="text-brand-400 hover:underline">Sign in</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
