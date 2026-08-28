// Repertoire manager — full-page browse + manage for every saved opening,
// line, and coach-shared entry. Complements the compact sidebar in /openings
// (MyRepertoirePanel). Opened via the "📚 Open in full manager" link at the
// top of that sidebar, or directly at /repertoire.
//
// Feature slate (owner ask 2026-08-28):
//   Tier 1  — search + facets + sort + mini-board previews + preview drawer
//             + bulk-select + star/pin
//   Tier 2  — per-entry progress metrics (FSRS reps/lapses/next-due),
//             academy-wide coverage report (What ECOs do I cover as
//             White vs Black?), Play-vs-engine link, weakness heatmap
//             (30-day retention colour dot on every card)
//   Item 21 — auto-classify every "line" entry via findOpeningForLine so
//             it picks up an ECO + name chip without saving anything new
//
// All progress data reads from client-side FSRS store (see lib/cards +
// lib/fsrs); no new server endpoints needed for this ship.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import Board from "../components/Board";
import { api } from "../lib/api";
import {
  listRepertoire, addRepertoire, deleteRepertoire, shareRepertoire, updateRepertoire, duplicateRepertoire,
  listRepertoireTrash, restoreRepertoire, listRepertoireVersions, rollbackRepertoire, pushToStudent,
  type RepertoireEntry, type RepMoveNode, type RepertoireVersion,
} from "../lib/repertoire-api";
import { OPENINGS, findOpeningForLine, openingBySlug, type Opening } from "../lib/openings";
import { activateRepertoireEntry, isRepertoireEntryActivated, loadAllStates, trainerSlugFor } from "../lib/cards";
import type { FsrsState } from "../lib/fsrs";
import { fetchExplorer, type ExplorerData, type ExplorerMove } from "../lib/explorer";

const STANDARD_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const K_STARS = "cg_rep_stars_v1";
const K_TAGS  = "cg_rep_tags_v1";     // { [entryId]: string[] } — Tier 5.18

// ─────────────────────────────────────────────────────────────────────
// Small pure helpers — kept top-level so the component tree stays clean.
// ─────────────────────────────────────────────────────────────────────

function loadStars(): Set<string> {
  try { const r = localStorage.getItem(K_STARS); return r ? new Set(JSON.parse(r)) : new Set(); } catch { return new Set(); }
}
function saveStars(s: Set<string>) {
  try { localStorage.setItem(K_STARS, JSON.stringify([...s])); } catch { /* quota */ }
}
// Tier 5.18 — user-defined tags, localStorage per browser. Not synced across
// devices yet (needs a schema addition on the repertoire entry). Users can
// still filter + bulk-tag today; migration to server-side is additive later.
function loadTags(): Record<string, string[]> {
  try { const r = localStorage.getItem(K_TAGS); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveTags(m: Record<string, string[]>) {
  try { localStorage.setItem(K_TAGS, JSON.stringify(m)); } catch { /* quota */ }
}
// All tags across every entry — for the filter chip list.
function allTagsFrom(map: Record<string, string[]>): string[] {
  const s = new Set<string>();
  for (const arr of Object.values(map)) for (const t of arr) s.add(t);
  return [...s].sort();
}

// ─────────────────────────────────────────────────────────────────────
// PGN import / export helpers (Tier 3)
// ─────────────────────────────────────────────────────────────────────

// Minimal PGN splitter — splits on blank-line-separated games and returns
// { headers: {}, sans: string[] } per game. Doesn't parse variations (that
// belongs in a proper PGN library — a follow-up if the demand is real).
function parsePgnGames(raw: string): Array<{ headers: Record<string, string>; sans: string[] }> {
  const games: Array<{ headers: Record<string, string>; sans: string[] }> = [];
  const chunks = raw.replace(/\r\n/g, "\n").split(/\n\n\s*(?=\[)/g);
  for (const chunk of chunks) {
    const headers: Record<string, string> = {};
    const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(chunk)) !== null) headers[m[1]!] = m[2]!;
    const movetext = chunk.replace(/\[[^\]]+\]/g, "")
      .replace(/\{[^}]*\}/g, "")     // comments
      .replace(/\([^()]*\)/g, "")    // shallow variations
      .replace(/\d+\.(\.\.)?/g, "")  // move numbers
      .replace(/\$\d+/g, "")         // NAGs
      .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, "")
      .trim();
    if (!movetext) continue;
    const rawSans = movetext.split(/\s+/).filter(Boolean);
    // Validate the run through chess.js so a malformed game doesn't smuggle
    // a bad line into the repertoire.
    try {
      const c = new Chess();
      const cleanSans: string[] = [];
      for (const s of rawSans) {
        const applied = c.move(s);
        if (!applied) break;
        cleanSans.push(applied.san);
      }
      if (cleanSans.length > 0) games.push({ headers, sans: cleanSans });
    } catch { /* skip broken game */ }
  }
  return games;
}
// Tier 3.12 — Lichess-study-compatible export. Lichess studies accept a PGN
// with FEN header for non-standard starts. We build one PGN per entry and
// concatenate with blank-line separators (Lichess splits into chapters).
function toLichessStudyPgn(entries: RepertoireEntry[]): string {
  const games: string[] = [];
  for (const e of entries) {
    const sans = e.kind === "corpus"
      ? (openingBySlug.get(e.slug ?? "")?.pgnStart ?? [])
      : (e.sans ?? []);
    if (sans.length === 0 && e.kind === "line") continue;
    const start = e.startFen && e.startFen.length > 0 ? e.startFen : STANDARD_START;
    const isCustomStart = start !== STANDARD_START;
    const headers = [
      `[Event "${e.name.replace(/"/g, "'")}"]`,
      `[Site "ChessGuru My Repertoire"]`,
      `[White "?"]`, `[Black "?"]`,
    ];
    if (isCustomStart) {
      headers.push(`[SetUp "1"]`, `[FEN "${start}"]`);
    }
    // Build the movetext with move numbers.
    const c = new Chess(start);
    const parts: string[] = [];
    for (let i = 0; i < sans.length; i++) {
      const applied = c.move(sans[i]!);
      if (!applied) break;
      const fullNo = Math.floor(i / 2) + Number(start.split(" ")[5] || "1");
      if (i % 2 === 0) parts.push(`${fullNo}. ${applied.san}`);
      else parts.push(applied.san);
    }
    games.push(headers.join("\n") + "\n\n" + parts.join(" ") + " *");
  }
  return games.join("\n\n");
}
function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

// Reconstruct the final FEN for an entry — corpus entries use the opening's
// canonical pgnStart, line entries replay sans (or tree's mainline). Falls
// back to the standard start if replay fails.
function finalFenFor(e: RepertoireEntry): string {
  const sans: string[] = e.kind === "corpus"
    ? (e.slug ? (openingBySlug.get(e.slug)?.pgnStart ?? []) : [])
    : (e.sans ?? []);
  try {
    const c = new Chess(e.startFen && e.startFen.length > 0 ? e.startFen : STANDARD_START);
    for (const s of sans) { if (!c.move(s)) break; }
    return c.fen();
  } catch { return STANDARD_START; }
}
// First non-empty SAN on the mainline → maps to a colour ("White repertoire"
// if it's a first-move-by-white; "Black repertoire" if the first move is
// black's response to a white opening — inferred from SAN parity).
function colourFor(e: RepertoireEntry): "white" | "black" | "unknown" {
  const sans = e.kind === "corpus"
    ? (e.slug ? (openingBySlug.get(e.slug)?.pgnStart ?? []) : [])
    : (e.sans ?? []);
  if (!sans.length) return "unknown";
  // If pgnStart begins with a WHITE move (odd-index pattern), it's white's
  // opening. Anything starting from move 2 (…c5 = Sicilian) is black-focused.
  // We approximate by SAN letter: a move of a piece to rank 3/4 mostly by
  // white; rank 5/6 by black. Simpler: infer from the corpus opening's ECO
  // (A/B = flank + semi-open black defences; C-E = e4 and d4 openings for
  // white). Not perfect — the corpus already carries this signal though.
  const eco = e.kind === "corpus" ? (openingBySlug.get(e.slug ?? "")?.eco ?? "") : (findOpeningForLine(sans)?.eco ?? "");
  if (!eco) {
    // Fallback: even-indexed pgnStart entries are black responses to a shown
    // white first move. Play the first SAN and check whose turn is now.
    try {
      const c = new Chess(); c.move(sans[0]!);
      return c.turn() === "w" ? "black" : "white";
    } catch { return "unknown"; }
  }
  // Rough rule: B* + A* first-move-c openings are typically Black
  // repertoire choices; C-E cover 1.e4 / 1.d4 White repertoires. Not exact
  // — user can override via a tag later.
  const first = eco[0];
  if (first === "B") return "black";
  return "white";
}
type ProgressMetrics = { reps: number; lapses: number; nextDueMs: number | null; accuracy: number | null; cardCount: number; retention: "green" | "amber" | "red" | "gray" };
// Aggregate FSRS state across every card that keys off this entry. Empty
// counts render as gray (never studied). Accuracy = reps / (reps + lapses).
function progressFor(e: RepertoireEntry, allStates: Record<string, FsrsState>): ProgressMetrics {
  const slug = trainerSlugFor(e);
  const prefix = slug ? `${slug}:` : null;
  const linePrefix = e.kind === "line" ? `line:${e._id}:` : null;
  let reps = 0, lapses = 0, cardCount = 0;
  let earliestDue: number | null = null;
  for (const [k, v] of Object.entries(allStates)) {
    if (!v) continue;
    const matches = (prefix && k.startsWith(prefix)) || (linePrefix && k.startsWith(linePrefix));
    if (!matches) continue;
    cardCount++;
    reps += v.reps || 0;
    lapses += v.lapses || 0;
    const dueMs = new Date(v.due).getTime();
    if (Number.isFinite(dueMs)) {
      if (earliestDue === null || dueMs < earliestDue) earliestDue = dueMs;
    }
  }
  const total = reps + lapses;
  const accuracy = total > 0 ? Math.round((reps / total) * 100) : null;
  const retention: ProgressMetrics["retention"] =
    total === 0 ? "gray"
    : accuracy! >= 85 ? "green"
    : accuracy! >= 60 ? "amber"
    : "red";
  return { reps, lapses, nextDueMs: earliestDue, accuracy, cardCount, retention };
}

// ─────────────────────────────────────────────────────────────────────
// Filters + sort configuration
// ─────────────────────────────────────────────────────────────────────

type KindFilter = "all" | "corpus" | "line-tree" | "line-flat";
type SourceFilter = "all" | "mine" | "shared" | "force";
type ColourFilter = "all" | "white" | "black";
type EcoFilter = "all" | "A" | "B" | "C" | "D" | "E";
type SortKey = "recent" | "name" | "eco" | "accuracy" | "reviewed";

const KIND_OPTS: Array<{ id: KindFilter; label: string; icon: string }> = [
  { id: "all",       label: "All",           icon: "📚" },
  { id: "corpus",    label: "Openings",      icon: "📖" },
  { id: "line-tree", label: "Trees",         icon: "🌳" },
  { id: "line-flat", label: "Lines",         icon: "✏️" },
];
const SOURCE_OPTS: Array<{ id: SourceFilter; label: string; icon: string }> = [
  { id: "all",    label: "All sources",   icon: "•" },
  { id: "mine",   label: "My own",        icon: "🧑" },
  { id: "shared", label: "From coach",    icon: "🎓" },
  { id: "force",  label: "⚡ Required",    icon: "⚡" },
];

// ─────────────────────────────────────────────────────────────────────

function CardMiniBoard({ fen }: { fen: string }) {
  return (
    <div className="pointer-events-none aspect-square w-full overflow-hidden rounded-md border border-ink-800/60">
      <Board fen={fen} coordinates={false} viewOnly dests={new Map() as any} />
    </div>
  );
}

function RetentionDot({ tone, title }: { tone: ProgressMetrics["retention"]; title: string }) {
  const cls = tone === "green" ? "bg-emerald-400"
    : tone === "amber" ? "bg-amber-400"
    : tone === "red" ? "bg-rose-500"
    : "bg-ink-600";
  return <span title={title} className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function CoverageReport({ entries }: { entries: RepertoireEntry[] }) {
  // Very lightweight coverage: count entries by colour + top-move family.
  // Not intended to be a full ECO audit — that's a Tier 5 build.
  const groups = useMemo(() => {
    let white = 0, black = 0;
    const whiteFams = new Map<string, number>();
    const blackFams = new Map<string, number>();
    for (const e of entries) {
      const col = colourFor(e);
      if (col === "white") white++;
      else if (col === "black") black++;
      const eco = e.kind === "corpus" ? (openingBySlug.get(e.slug ?? "")?.eco ?? "") : "";
      if (eco) {
        const fam = eco[0]!;
        const bucket = col === "black" ? blackFams : whiteFams;
        bucket.set(fam, (bucket.get(fam) ?? 0) + 1);
      }
    }
    return { white, black, whiteFams: [...whiteFams].sort(), blackFams: [...blackFams].sort() };
  }, [entries]);
  const bar = (n: number, of: number) => `${of > 0 ? Math.round((n / Math.max(1, of)) * 100) : 0}%`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-sky-500/40 bg-gradient-to-br from-sky-500/15 to-sky-500/5 p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-display text-sm font-bold text-sky-100">♔ White repertoire</div>
          <div className="font-mono text-lg font-black text-white">{groups.white}</div>
        </div>
        <div className="mt-1 text-[10px] text-sky-200/80">{bar(groups.white, entries.length)} of your saved entries</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {groups.whiteFams.length === 0 && <span className="text-[10px] text-ink-500">No corpus openings yet</span>}
          {groups.whiteFams.map(([f, n]) => (
            <span key={f} className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold text-sky-100" title={`${n} entries in the ${f}xx range`}>{f} · {n}</span>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-rose-500/40 bg-gradient-to-br from-rose-500/15 to-rose-500/5 p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-display text-sm font-bold text-rose-100">♚ Black repertoire</div>
          <div className="font-mono text-lg font-black text-white">{groups.black}</div>
        </div>
        <div className="mt-1 text-[10px] text-rose-200/80">{bar(groups.black, entries.length)} of your saved entries</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {groups.blackFams.length === 0 && <span className="text-[10px] text-ink-500">No corpus openings yet</span>}
          {groups.blackFams.map(([f, n]) => (
            <span key={f} className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-100" title={`${n} entries in the ${f}xx range`}>{f} · {n}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

export default function RepertoirePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const loggedIn = !!auth?.loggedIn;
  const isCoach = auth?.role === "coach" || auth?.role === "academy_owner";

  const { data, isLoading } = useQuery({
    queryKey: ["my-repertoire"],
    queryFn: listRepertoire,
    enabled: loggedIn,
  });
  const [allStates, setAllStates] = useState<Record<string, FsrsState>>(() => loadAllStates() as any);
  useEffect(() => {
    // FSRS store lives in localStorage; refresh on window focus so a fresh
    // trainer session's updates show up when the user tabs back.
    const on = () => setAllStates(loadAllStates() as any);
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, []);
  const [stars, setStars] = useState<Set<string>>(() => loadStars());
  const toggleStar = (id: string) => {
    setStars((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      saveStars(n);
      return n;
    });
  };
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>(() => loadTags());
  const setEntryTags = (id: string, tags: string[]) => {
    setTagsMap((prev) => {
      const n = { ...prev }; if (tags.length === 0) delete n[id]; else n[id] = tags;
      saveTags(n); return n;
    });
  };
  const [importOpen, setImportOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [versionsFor, setVersionsFor] = useState<RepertoireEntry | null>(null);
  const [pushFor, setPushFor] = useState<RepertoireEntry | null>(null);
  const { data: trashData } = useQuery({
    queryKey: ["my-repertoire-trash"],
    queryFn: listRepertoireTrash,
    enabled: loggedIn && showTrash,
    staleTime: 30_000,
  });
  const restoreMut = useMutation({
    mutationFn: restoreRepertoire,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-repertoire"] });
      qc.invalidateQueries({ queryKey: ["my-repertoire-trash"] });
    },
  });

  const entries = data?.entries ?? [];

  // Auto-classify: for line entries without a slug hint, look up
  // findOpeningForLine on the SANs to surface an ECO+name chip. Cached
  // alongside the entries. Item 21 of the ship plan.
  const enriched = useMemo(() => {
    return entries.map((e) => {
      const classified = e.kind === "line"
        ? (findOpeningForLine(e.sans ?? []) ?? null)
        : (e.slug ? (openingBySlug.get(e.slug) ?? null) : null);
      return { entry: e, classified, colour: colourFor(e), progress: progressFor(e, allStates) };
    });
  }, [entries, allStates]);

  // ── Filter + sort state ─────────────────────────────────────────
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [colour, setColour] = useState<ColourFilter>("all");
  const [ecoFam, setEcoFam] = useState<EcoFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [starsOnly, setStarsOnly] = useState(false);

  const filtered = useMemo(() => {
    let out = enriched;
    if (starsOnly) out = out.filter((r) => stars.has(r.entry._id));
    if (kind !== "all") {
      out = out.filter(({ entry: e }) => {
        if (kind === "corpus") return e.kind === "corpus";
        if (kind === "line-tree") return e.kind === "line" && !!(e.tree && e.tree.length > 0);
        if (kind === "line-flat") return e.kind === "line" && !(e.tree && e.tree.length > 0);
        return true;
      });
    }
    if (source !== "all") {
      out = out.filter(({ entry: e }) => {
        if (source === "mine")   return !e.sharedFrom;
        if (source === "shared") return !!e.sharedFrom;
        if (source === "force")  return !!e.forceTrain;
        return true;
      });
    }
    if (colour !== "all") out = out.filter((r) => r.colour === colour);
    if (ecoFam !== "all") {
      out = out.filter((r) => {
        const eco = r.classified?.eco ?? "";
        return eco[0] === ecoFam;
      });
    }
    if (tagFilter) out = out.filter(({ entry: e }) => (tagsMap[e._id] ?? []).includes(tagFilter));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter(({ entry: e, classified }) =>
        (e.name || "").toLowerCase().includes(needle) ||
        (e.slug || "").toLowerCase().includes(needle) ||
        (classified?.name ?? "").toLowerCase().includes(needle) ||
        (classified?.eco ?? "").toLowerCase().includes(needle)
      );
    }
    const cmp = (a: typeof out[number], b: typeof out[number]) => {
      // Stars pin above everything else regardless of sort.
      const sa = stars.has(a.entry._id) ? 1 : 0, sb = stars.has(b.entry._id) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      switch (sort) {
        case "recent":   return new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime();
        case "name":     return (a.entry.name || "").localeCompare(b.entry.name || "");
        case "eco":      return (a.classified?.eco ?? "z").localeCompare(b.classified?.eco ?? "z");
        case "accuracy": return (b.progress.accuracy ?? -1) - (a.progress.accuracy ?? -1);
        case "reviewed": return (b.progress.reps + b.progress.lapses) - (a.progress.reps + a.progress.lapses);
      }
    };
    return [...out].sort(cmp);
  }, [enriched, kind, source, colour, ecoFam, tagFilter, tagsMap, q, sort, stars, starsOnly]);
  const allTags = useMemo(() => allTagsFrom(tagsMap), [tagsMap]);

  // Preview + bulk-select state.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulk, setBulk] = useState<Set<string>>(new Set());
  const toggleBulk = (id: string) => {
    setBulk((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const clearBulk = () => { setBulk(new Set()); setBulkMode(false); };

  // Mutations for bulk actions.
  const delMut = useMutation({ mutationFn: deleteRepertoire, onSuccess: () => qc.invalidateQueries({ queryKey: ["my-repertoire"] }) });
  const dupMut = useMutation({ mutationFn: (id: string) => duplicateRepertoire(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["my-repertoire"] }) });
  const forceMut = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => updateRepertoire(id, { forceTrain: force }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-repertoire"] }),
  });

  const bulkDelete = async () => {
    if (bulk.size === 0) return;
    if (!confirm(`Remove ${bulk.size} entries?`)) return;
    for (const id of bulk) { try { await delMut.mutateAsync(id); } catch { /* skip failures */ } }
    clearBulk();
  };
  const bulkActivate = () => {
    for (const id of bulk) {
      const r = enriched.find((x) => x.entry._id === id);
      if (r) activateRepertoireEntry(r.entry);
    }
    setAllStates(loadAllStates() as any);
    clearBulk();
  };
  const bulkDuplicate = async () => {
    for (const id of bulk) { try { await dupMut.mutateAsync(id); } catch { /* skip */ } }
    clearBulk();
  };
  // Tier 4.15 — flip forceTrain on every selected. Only meaningful when the
  // caller OWNS the entry (server checks) — copies to students will re-fan
  // out to their inboxes with the updated flag.
  const bulkForceTrain = async (force: boolean) => {
    for (const id of bulk) { try { await forceMut.mutateAsync({ id, force }); } catch { /* skip */ } }
    clearBulk();
  };
  // Tier 5.18 — assign a tag to every selected entry. Prompts for tag string;
  // localStorage-scoped per browser (see K_TAGS).
  const bulkTag = () => {
    const tag = window.prompt("Tag name (e.g. '🔥 sharp' or 'exam-prep')")?.trim();
    if (!tag) return;
    setTagsMap((prev) => {
      const n = { ...prev };
      for (const id of bulk) {
        const cur = new Set(n[id] ?? []);
        cur.add(tag);
        n[id] = [...cur];
      }
      saveTags(n);
      return n;
    });
    clearBulk();
  };

  const selected = selectedId ? enriched.find((r) => r.entry._id === selectedId) ?? null : null;

  if (!loggedIn) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="text-4xl">📚</div>
      <div className="mt-3 font-display text-lg text-white">Sign in to see your repertoire</div>
      <Link to="/login" className="mt-4 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">Sign in</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-3 py-4">
      {/* Header row — title + Sort + bulk-mode toggle. */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">📚 My Repertoire</h1>
          <div className="text-xs text-ink-400">{entries.length} saved · manage, browse, drill.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-ink-500">Sort:</label>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100">
            <option value="recent">Recently added</option>
            <option value="name">Name</option>
            <option value="eco">ECO</option>
            <option value="accuracy">Accuracy</option>
            <option value="reviewed">Times reviewed</option>
          </select>
          <button
            onClick={() => { setBulkMode((v) => !v); if (bulkMode) setBulk(new Set()); }}
            className={`rounded-md border px-2 py-1 font-semibold transition ${bulkMode ? "border-brand-500 bg-brand-500/20 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-200 hover:bg-ink-800"}`}
            title="Toggle bulk-select mode">
            {bulkMode ? "✓ Selecting" : "☐ Bulk"}
          </button>
          {/* Tier 3 toolbar — Import PGN / Export PGN / Print */}
          <button onClick={() => setImportOpen(true)}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-200 hover:bg-emerald-500/20"
            title="Import lines from PGN — one entry per game">
            📥 Import PGN
          </button>
          <button onClick={() => downloadText(`repertoire-${new Date().toISOString().slice(0,10)}.pgn`, toLichessStudyPgn(entries))}
            disabled={entries.length === 0}
            className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-1 font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
            title="Download the whole repertoire as a Lichess-study-compatible PGN">
            📤 Export
          </button>
          <button onClick={() => { document.body.classList.add("rep-print"); setTimeout(() => { window.print(); document.body.classList.remove("rep-print"); }, 100); }}
            className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 font-semibold text-ink-200 hover:bg-ink-800"
            title="Print-friendly PDF of the current filtered view">
            🖨️ Print
          </button>
          <button onClick={() => setShowTrash((v) => !v)}
            className={`rounded-md border px-2 py-1 font-semibold transition ${showTrash ? "border-rose-500 bg-rose-500/20 text-rose-100" : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
            title="Toggle trash view — entries deleted in the last 30 days">
            🗑 {showTrash ? "Trash on" : "Trash"}
          </button>
        </div>
      </div>

      {/* Trash view — replaces the main content when toggled on. Owner ask
       *  2026-08-28. Auto-purges after 30 days via server list()'s
       *  purgeTrash. */}
      {showTrash ? (
        <TrashView
          entries={trashData?.entries ?? []}
          onRestore={(id) => restoreMut.mutate(id)}
          onPurgeNow={(id) => delMut.mutate(id)}
          isLoading={!trashData}
          onExit={() => setShowTrash(false)}
        />
      ) : (
        <>
      {/* Coverage report — Tier 2 item 8. Compact 2-column banner. */}
      <div className="mb-5"><CoverageReport entries={entries} /></div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        {/* ─────── LEFT RAIL: facet filters ─────── */}
        <aside className="space-y-3 self-start">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-ink-500">Search</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ECO, slug…"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <FacetGroup title="Kind" opts={KIND_OPTS.map(o => ({ id: o.id, label: `${o.icon} ${o.label}` }))} value={kind} onChange={(v) => setKind(v as KindFilter)} />
          <FacetGroup title="Source" opts={SOURCE_OPTS.map(o => ({ id: o.id, label: `${o.icon} ${o.label}` }))} value={source} onChange={(v) => setSource(v as SourceFilter)} />
          <FacetGroup title="Colour" opts={[
            { id: "all", label: "All" },
            { id: "white", label: "♔ White" },
            { id: "black", label: "♚ Black" },
          ]} value={colour} onChange={(v) => setColour(v as ColourFilter)} />
          <FacetGroup title="ECO family" opts={[
            { id: "all", label: "All" }, { id: "A", label: "A · Flank" }, { id: "B", label: "B · Semi-open" },
            { id: "C", label: "C · 1.e4 e5" }, { id: "D", label: "D · Closed / 1.d4 d5" }, { id: "E", label: "E · Indian" },
          ]} value={ecoFam} onChange={(v) => setEcoFam(v as EcoFilter)} />
          <button
            onClick={() => setStarsOnly((v) => !v)}
            className={`w-full rounded-lg border px-3 py-1.5 text-left text-sm transition ${starsOnly ? "border-amber-500/60 bg-amber-500/15 text-amber-100" : "border-ink-800 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
            ⭐ {starsOnly ? "Showing stars only" : "Show stars only"}
          </button>
          {allTags.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-500">Tags</div>
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setTagFilter(null)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tagFilter === null ? "border-brand-500 bg-brand-500/25 text-white" : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                  All
                </button>
                {allTags.map((t) => (
                  <button key={t} onClick={() => setTagFilter(t === tagFilter ? null : t)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tagFilter === t ? "border-fuchsia-500 bg-fuchsia-500/25 text-white" : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ─────── MAIN: card grid ─────── */}
        <main className="min-w-0">
          {isLoading ? (
            <div className="text-sm text-ink-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-10 text-center">
              <div className="text-5xl">📚</div>
              <div className="mt-3 font-display text-lg text-white">Nothing matches these filters</div>
              <div className="mt-1 text-xs text-ink-400">
                {entries.length === 0
                  ? <>Save openings from <Link to="/openings" className="text-brand-300 underline">/openings</Link> to fill your repertoire.</>
                  : "Clear a filter to see more entries."}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map(({ entry: e, classified, colour: col, progress: p }) => {
                const isSel = selectedId === e._id;
                const isBulk = bulk.has(e._id);
                const starred = stars.has(e._id);
                const fen = finalFenFor(e);
                const eco = classified?.eco ?? "";
                const cardKindAccent = e.forceTrain ? "border-l-amber-400"
                  : e.kind === "corpus" ? "border-l-sky-400"
                  : e.tree ? "border-l-emerald-400" : "border-l-brand-400";
                return (
                  <div key={e._id}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border border-ink-800 border-l-2 ${cardKindAccent} bg-gradient-to-b from-ink-900 to-ink-950 transition hover:border-ink-700 hover:shadow-lg hover:shadow-brand-500/5 ${isSel ? "ring-2 ring-brand-500/60" : ""}`}>
                    {/* Top row inside the card — checkbox (bulk mode) + star */}
                    <div className="absolute right-2 top-2 z-10 flex gap-1">
                      {bulkMode && (
                        <label className="cursor-pointer">
                          <input type="checkbox" checked={isBulk} onChange={() => toggleBulk(e._id)} className="h-4 w-4 accent-brand-500" />
                        </label>
                      )}
                      <button onClick={() => toggleStar(e._id)}
                        className={`text-sm transition ${starred ? "text-amber-300 hover:text-amber-200" : "text-ink-600 hover:text-amber-300"}`}
                        title={starred ? "Unstar" : "Star (pin to top)"}>
                        {starred ? "⭐" : "☆"}
                      </button>
                    </div>
                    {/* Retention dot in top-LEFT — one-glance signal of study health */}
                    <div className="absolute left-2 top-2 z-10">
                      <RetentionDot tone={p.retention}
                        title={p.cardCount === 0 ? "Never studied"
                          : `${p.accuracy}% accuracy over ${p.reps + p.lapses} reviews`} />
                    </div>
                    {/* Mini board — clickable for preview */}
                    <button onClick={() => setSelectedId(e._id)}
                      className="p-3 pb-2" title="Preview">
                      <CardMiniBoard fen={fen} />
                    </button>
                    {/* Meta */}
                    <div className="px-3 pb-3">
                      <div className="mb-1 flex items-start gap-1.5">
                        {eco && <span className="shrink-0 rounded bg-brand-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-200">{eco}</span>}
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={e.name}>{e.name}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-500">
                        <span>{e.kind === "corpus" ? "📖 Opening" : (e.tree ? "🌳 Tree" : "✏️ Line")}</span>
                        {e.kind === "line" && <span>· {(e.sans?.length ?? 0)} moves</span>}
                        {col !== "unknown" && <span className={col === "white" ? "text-sky-300" : "text-rose-300"}>· {col === "white" ? "♔" : "♚"}</span>}
                        {e.sharedFromName && <span className="text-indigo-300">· from {e.sharedFromName}</span>}
                        {e.forceTrain && <span className="text-amber-300">· ⚡ required</span>}
                      </div>
                      {p.cardCount > 0 && (
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-500">
                          <span className="font-mono text-ink-300">{p.accuracy}%</span>
                          <span>· {p.reps + p.lapses} reviews</span>
                          {p.nextDueMs && (
                            <span className={p.nextDueMs < Date.now() ? "text-amber-300" : ""}>
                              · {p.nextDueMs < Date.now() ? "due now" : `due ${new Date(p.nextDueMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                            </span>
                          )}
                        </div>
                      )}
                      {(tagsMap[e._id] ?? []).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {(tagsMap[e._id] ?? []).map((t) => (
                            <button key={t} onClick={(ev) => { ev.stopPropagation();
                              const cur = tagsMap[e._id] ?? [];
                              setEntryTags(e._id, cur.filter((x) => x !== t));
                            }}
                              title={`Click to remove tag "${t}"`}
                              className="rounded-full bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/30">
                              {t} ×
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="mt-auto flex items-center justify-between gap-1 border-t border-ink-800/60 bg-ink-950/40 px-2 py-1.5 text-[10px]">
                      <button
                        onClick={() => navigate(`/openings?load=${encodeURIComponent(e._id)}`)}
                        className="rounded px-2 py-0.5 font-bold text-brand-300 hover:bg-brand-500/15 hover:text-brand-100">
                        📚 Study
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { activateRepertoireEntry(e); setAllStates(loadAllStates() as any); }}
                          disabled={isRepertoireEntryActivated(e)}
                          className={`rounded px-1.5 py-0.5 font-semibold ${isRepertoireEntryActivated(e) ? "text-emerald-300 cursor-default" : "text-fuchsia-300 hover:bg-fuchsia-500/15 hover:text-fuchsia-100"}`}
                          title={isRepertoireEntryActivated(e) ? "In Opening Trainer" : "Add to Opening Trainer"}>
                          {isRepertoireEntryActivated(e) ? "✓" : "📅"}
                        </button>
                        <button
                          onClick={() => navigate(`/openings?load=${encodeURIComponent(e._id)}&engineDrill=1`)}
                          className="rounded px-1.5 py-0.5 font-semibold text-ink-400 hover:bg-ink-800 hover:text-brand-300"
                          title="Play this line vs the engine">▶</button>
                        <button
                          onClick={() => setVersionsFor(e)}
                          className="rounded px-1.5 py-0.5 font-semibold text-ink-400 hover:bg-ink-800 hover:text-sky-300"
                          title="Version history">🕘</button>
                        {isCoach && !e.sharedFrom && (
                          <button
                            onClick={() => setPushFor(e)}
                            className="rounded px-1.5 py-0.5 font-semibold text-ink-400 hover:bg-ink-800 hover:text-emerald-300"
                            title="Push this line to one student's repertoire">👤</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* ─────── RIGHT: preview drawer (lg+ only) ─────── */}
        <aside className="hidden self-start rounded-xl border border-ink-800 bg-ink-900/60 p-3 lg:block">
          {!selected ? (
            <div className="p-6 text-center text-[11px] text-ink-500">
              <div className="text-2xl">👁️</div>
              <div className="mt-2">Click any card to preview its board + moves here.</div>
            </div>
          ) : (
            <PreviewPane row={selected} onClose={() => setSelectedId(null)} />
          )}
        </aside>
      </div>

        </>
      )}

      {/* Bulk action bar — fixed at bottom, only when bulkMode + some selected. */}
      {bulkMode && bulk.size > 0 && !showTrash && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/50 bg-ink-900/95 px-4 py-2 shadow-2xl backdrop-blur">
            <span className="text-sm font-semibold text-brand-200">{bulk.size} selected</span>
            <span className="text-ink-700">|</span>
            <button onClick={bulkActivate} className="rounded px-2 py-1 text-xs font-semibold text-fuchsia-300 hover:bg-fuchsia-500/15">📅 Add to Trainer</button>
            <button onClick={bulkDuplicate} className="rounded px-2 py-1 text-xs font-semibold text-ink-200 hover:bg-ink-800">📋 Duplicate</button>
            <button onClick={bulkTag} className="rounded px-2 py-1 text-xs font-semibold text-fuchsia-300 hover:bg-fuchsia-500/15" title="Add a tag to every selected entry">🏷️ Tag</button>
            {isCoach && <BulkShareButton bulkIds={[...bulk]} entries={entries} onDone={clearBulk} />}
            {isCoach && (
              <>
                <button onClick={() => bulkForceTrain(true)}
                  className="rounded px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/15"
                  title="Mark all selected as required-study (students can't remove from Opening Trainer)">
                  ⚡ Require
                </button>
                <button onClick={() => bulkForceTrain(false)}
                  className="rounded px-2 py-1 text-xs font-semibold text-ink-300 hover:bg-ink-800"
                  title="Remove required-study flag on all selected">
                  ⚡ Unrequire
                </button>
              </>
            )}
            <button onClick={bulkDelete} className="rounded px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/15">🗑 Delete</button>
            <button onClick={clearBulk} className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-800">Cancel</button>
          </div>
        </div>
      )}
      {importOpen && <ImportPgnModal onClose={() => setImportOpen(false)} onDone={(n) => { setImportOpen(false); qc.invalidateQueries({ queryKey: ["my-repertoire"] }); alert(`Imported ${n} entries.`); }} />}
      {versionsFor && <VersionsModal entry={versionsFor} onClose={() => setVersionsFor(null)} onRolled={() => { qc.invalidateQueries({ queryKey: ["my-repertoire"] }); setVersionsFor(null); }} />}
      {pushFor && <PushToStudentModal entry={pushFor} onClose={() => setPushFor(null)} onDone={(n) => { setPushFor(null); alert(n === 0 ? "Not shared (skipped)." : `👤 Pushed to ${n} student.`); }} />}
      {/* Print-only stylesheet — hides chrome so the grid prints cleanly. */}
      <style>{`
        @media print {
          body.rep-print aside, body.rep-print header, body.rep-print nav, body.rep-print footer,
          body.rep-print [data-rep-hide-in-print], body.rep-print .no-print { display: none !important; }
          body.rep-print { background: #fff !important; color: #000 !important; }
          body.rep-print .bg-ink-900, body.rep-print .bg-ink-950, body.rep-print .bg-ink-800 { background: #fff !important; }
          body.rep-print .text-white, body.rep-print .text-ink-100, body.rep-print .text-ink-200, body.rep-print .text-ink-300 { color: #000 !important; }
          body.rep-print button { border: 1px solid #ccc !important; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PGN import — Tier 3.11
// ─────────────────────────────────────────────────────────────────────
function ImportPgnModal({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => text.trim() ? parsePgnGames(text) : [], [text]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doImport = async () => {
    if (parsed.length === 0) { setErr("Nothing to import."); return; }
    setBusy(true); setErr(null);
    let ok = 0;
    for (const g of parsed) {
      const name = g.headers.Event || g.headers.White || g.headers.Site || `Line — ${g.sans.slice(0, 3).join(" ")}`;
      try {
        await addRepertoire({ name: name.slice(0, 140), kind: "line", sans: g.sans });
        ok++;
      } catch { /* skip failure */ }
    }
    setBusy(false);
    onDone(ok);
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} tabIndex={-1}>
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl max-h-[90vh]">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-display text-lg font-bold text-white">📥 Import PGN</div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <div className="mb-2 text-xs text-ink-400">Paste one or more PGN games. Each game becomes a separate repertoire entry. Comments + variations are stripped; only the mainline is saved (bring the tree in via Save-from-Dream Meet).</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='[Event "Ruy Lopez"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 …'
          className="flex-1 min-h-[220px] w-full rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-[11px] text-white focus:border-emerald-500 focus:outline-none" />
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
          <div>{parsed.length > 0 ? `Detected ${parsed.length} game${parsed.length === 1 ? "" : "s"}.` : "No games detected yet."}</div>
          {parsed.length > 0 && <div className="text-ink-500">{parsed.reduce((s, g) => s + g.sans.length, 0)} moves total</div>}
        </div>
        {err && <div className="mt-2 text-[12px] text-rose-400">{err}</div>}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={doImport} disabled={busy || parsed.length === 0}
            className="flex-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-bold text-white shadow hover:brightness-110 disabled:opacity-60">
            {busy ? "Importing…" : `📥 Import ${parsed.length}`}
          </button>
          <button onClick={onClose} className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-ink-200 hover:bg-ink-700">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FacetGroup({ title, opts, value, onChange }: { title: string; opts: Array<{ id: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-500">{title}</div>
      <div className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <button key={o.id} onClick={() => onChange(o.id)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${value === o.id ? "border-brand-500 bg-brand-500/25 text-white" : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewPane({ row, onClose }: { row: { entry: RepertoireEntry; classified: Opening | null; progress: ProgressMetrics }; onClose: () => void }) {
  const { entry: e, classified, progress } = row;
  const navigate = useNavigate();
  const fen = finalFenFor(e);
  // Tier 5.20 — master games at the FINAL fen. Only queried when the drawer
  // is open (row is set) so we don't fan out fetches for every card.
  const { data: masters } = useQuery({
    queryKey: ["rep-preview-masters", fen],
    queryFn: () => fetchExplorer(fen, "masters"),
    staleTime: 60_000,
    enabled: !!fen,
  });
  // Notation: walk sans (or tree mainline).
  const sansForPreview = useMemo(() => {
    if (e.kind === "corpus") return openingBySlug.get(e.slug ?? "")?.pgnStart ?? [];
    if (e.tree && e.tree.length > 0) {
      const walk = (nodes: RepMoveNode[]): string[] => {
        const out: string[] = [];
        let cur: RepMoveNode | undefined = nodes[0];
        while (cur) { out.push(cur.san); cur = cur.children[0]; }
        return out;
      };
      return walk(e.tree);
    }
    return e.sans ?? [];
  }, [e]);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-bold text-white">{e.name}</div>
          {classified && <div className="text-[10px] text-brand-300 font-mono">{classified.eco} · {classified.name}</div>}
        </div>
        <button onClick={onClose} className="text-ink-500 hover:text-white">×</button>
      </div>
      <div className="mb-2">
        <Board fen={fen} coordinates viewOnly dests={new Map() as any} />
      </div>
      <div className="max-h-[180px] overflow-y-auto rounded-md border border-ink-800 bg-ink-950 p-2 font-mono text-xs text-ink-100">
        {sansForPreview.length === 0 ? (
          <span className="text-ink-500">No moves.</span>
        ) : (
          sansForPreview.map((san, i) => (
            <span key={i} className="mr-1">
              {i % 2 === 0 && <span className="text-ink-500">{Math.floor(i / 2) + 1}. </span>}
              {san}{" "}
            </span>
          ))
        )}
      </div>
      {progress.cardCount > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 py-1.5">
            <div className="font-mono text-base font-bold text-emerald-200">{progress.accuracy}%</div>
            <div className="text-emerald-300/80">accuracy</div>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-800/50 py-1.5">
            <div className="font-mono text-base font-bold text-white">{progress.reps + progress.lapses}</div>
            <div className="text-ink-400">reviews</div>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-800/50 py-1.5">
            <div className="font-mono text-base font-bold text-white">{progress.cardCount}</div>
            <div className="text-ink-400">cards</div>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => navigate(`/openings?load=${encodeURIComponent(e._id)}`)}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-400">
          📚 Study
        </button>
        <button onClick={() => navigate(`/openings?load=${encodeURIComponent(e._id)}&engineDrill=1`)}
          className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">
          ▶ vs engine
        </button>
      </div>
      {masters && (masters.white + masters.draws + masters.black) > 0 && (
        <div className="mt-3 rounded-lg border border-ink-800 bg-ink-900/50 p-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-500">♞ Master games at this position</div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-2 flex-1 overflow-hidden rounded" title={`+${masters.white} =${masters.draws} -${masters.black}`}>
              <span className="bg-emerald-400" style={{ width: `${(masters.white / (masters.white + masters.draws + masters.black)) * 100}%` }} />
              <span className="bg-ink-500" style={{ width: `${(masters.draws / (masters.white + masters.draws + masters.black)) * 100}%` }} />
              <span className="bg-rose-600" style={{ width: `${(masters.black / (masters.white + masters.draws + masters.black)) * 100}%` }} />
            </span>
            <span className="text-[10px] text-ink-500">{(masters.white + masters.draws + masters.black).toLocaleString()}</span>
          </div>
          <div className="max-h-32 space-y-0.5 overflow-y-auto">
            {(masters.moves ?? []).slice(0, 6).map((m: ExplorerMove) => {
              const total = m.white + m.draws + m.black;
              return (
                <div key={m.uci} className="flex items-center gap-2 text-[10px]">
                  <span className="w-12 font-mono font-bold text-ink-100">{m.san}</span>
                  <span className="w-14 text-right text-ink-500">{total.toLocaleString()}</span>
                  <span className="flex h-1.5 flex-1 overflow-hidden rounded" title={`+${m.white} =${m.draws} -${m.black}`}>
                    <span className="bg-emerald-400" style={{ width: `${(m.white / total) * 100}%` }} />
                    <span className="bg-ink-500" style={{ width: `${(m.draws / total) * 100}%` }} />
                    <span className="bg-rose-600" style={{ width: `${(m.black / total) * 100}%` }} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BulkShareButton({ bulkIds, entries, onDone }: { bulkIds: string[]; entries: RepertoireEntry[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);
  const doShare = async () => {
    // Fetch academy roster then confirm before firing.
    setBusy(true);
    try {
      const roster = await fetch("/v2api/api/academy/students-lite", { credentials: "include" }).then((r) => r.json());
      const studentIds: string[] = (roster.students ?? []).map((s: any) => s.userId);
      if (studentIds.length === 0) { setToast("No students to share with."); return; }
      if (!confirm(`Share ${bulkIds.length} entries with all ${studentIds.length} students?`)) return;
      let ok = 0;
      for (const id of bulkIds) {
        try { await shareRepertoire(id, studentIds, false); ok++; } catch { /* skip */ }
      }
      setToast(`🎓 Shared ${ok}/${bulkIds.length}`);
      onDone();
    } catch {
      setToast("Share failed");
    } finally { setBusy(false); }
  };
  void entries;
  return (
    <>
      <button onClick={doShare} disabled={busy}
        className="rounded px-2 py-1 text-xs font-semibold text-brand-300 hover:bg-brand-500/15 disabled:opacity-60">
        🎓 Share
      </button>
      {toast && <span className="text-xs text-emerald-300">{toast}</span>}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tier 5.19 — Trash view
// ─────────────────────────────────────────────────────────────────────
function TrashView({ entries, onRestore, onPurgeNow, isLoading, onExit }: {
  entries: RepertoireEntry[]; onRestore: (id: string) => void; onPurgeNow: (id: string) => void;
  isLoading: boolean; onExit: () => void;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-rose-500/40 bg-gradient-to-br from-rose-500/5 to-ink-900 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="font-display text-lg font-bold text-rose-100">🗑 Trash</div>
          <div className="text-xs text-rose-200/70">Entries deleted in the last 30 days. After that, they're purged automatically on the next load.</div>
        </div>
        <button onClick={onExit} className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700">← Back to repertoire</button>
      </div>
      {isLoading ? (
        <div className="text-sm text-ink-500">Loading trash…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-950/50 p-6 text-center text-sm text-ink-400">
          Trash is empty.
        </div>
      ) : (
        <ul className="divide-y divide-rose-500/10">
          {entries.map((e) => (
            <li key={e._id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{e.name}</div>
                <div className="text-[10px] text-ink-500">
                  {e.kind === "corpus" ? "Opening" : "Line"} · {(e as any).deletedAt ? `deleted ${new Date((e as any).deletedAt).toLocaleString()}` : "deleted"}
                </div>
              </div>
              <button onClick={() => onRestore(e._id)}
                className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-400">♻ Restore</button>
              <button onClick={() => { if (confirm(`Permanently purge "${e.name}"? This can't be undone.`)) onPurgeNow(e._id); }}
                className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20">Purge now</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tier 4.17 — Version history + rollback
// ─────────────────────────────────────────────────────────────────────
function VersionsModal({ entry, onClose, onRolled }: { entry: RepertoireEntry; onClose: () => void; onRolled: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["rep-versions", entry._id],
    queryFn: () => listRepertoireVersions(entry._id),
    staleTime: 15_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const rollback = async (v: RepertoireVersion) => {
    if (!confirm(`Roll back "${entry.name}" to the snapshot from ${new Date(v.at).toLocaleString()}?`)) return;
    setBusy(v._id);
    try { await rollbackRepertoire(entry._id, v._id); onRolled(); }
    catch (e: any) { alert(e?.message || "Rollback failed"); }
    finally { setBusy(null); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} tabIndex={-1}>
      <div className="flex w-full max-w-lg flex-col rounded-2xl border border-sky-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl max-h-[85vh]">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <div className="font-display text-base font-bold text-white">🕘 Version history</div>
            <div className="text-[11px] text-ink-400">{entry.name}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        {isLoading ? (
          <div className="text-sm text-ink-500">Loading…</div>
        ) : (data?.versions ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-700 bg-ink-950/50 p-6 text-center text-sm text-ink-400">
            No history yet — versions are recorded from your next edit onward.
          </div>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-ink-800 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/50">
            {(data?.versions ?? []).map((v) => {
              const kindIcon = v.kind === "edit" ? "✏️" : v.kind === "delete" ? "🗑" : "♻";
              const sanCount = Array.isArray(v.snapshot?.sans) ? v.snapshot.sans!.length : 0;
              const hasTree = Array.isArray(v.snapshot?.tree) && v.snapshot.tree!.length > 0;
              return (
                <li key={v._id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">
                      <span className="mr-1">{kindIcon}</span>{v.snapshot.name || entry.name}
                    </div>
                    <div className="text-[10px] text-ink-500">
                      {new Date(v.at).toLocaleString()} · {sanCount} moves{hasTree ? " · +variations" : ""}
                      {v.snapshot.startFen && v.snapshot.startFen !== STANDARD_START ? " · setup" : ""}
                      {v.snapshot.forceTrain ? " · ⚡" : ""}
                    </div>
                  </div>
                  <button onClick={() => rollback(v)} disabled={!!busy}
                    className="rounded-md border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-100 hover:bg-sky-500/25 disabled:opacity-60">
                    {busy === v._id ? "…" : "♻ Restore this"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tier 4.16 — Push single entry to ONE student
// ─────────────────────────────────────────────────────────────────────
type StudentLite = { userId: string; username: string; name: string };
function PushToStudentModal({ entry, onClose, onDone }: { entry: RepertoireEntry; onClose: () => void; onDone: (n: number) => void }) {
  const { data } = useQuery({
    queryKey: ["academy-students-lite"],
    queryFn: () => fetch("/v2api/api/academy/students-lite", { credentials: "include" }).then((r) => r.ok ? r.json() : { students: [] }),
    staleTime: 60_000,
  });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roster: StudentLite[] = data?.students ?? [];
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return roster;
    return roster.filter((s) => s.name.toLowerCase().includes(n) || s.username.toLowerCase().includes(n));
  }, [roster, q]);
  const doPush = async (studentId: string) => {
    setBusy(true); setErr(null);
    try {
      const body: any = { name: entry.name, kind: entry.kind };
      if (entry.kind === "corpus") body.slug = entry.slug;
      else { body.sans = entry.sans ?? []; if (entry.tree) body.tree = entry.tree; }
      await pushToStudent(studentId, body);
      onDone(1);
    } catch (e: any) {
      setErr(e?.message || "Push failed");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} tabIndex={-1}>
      <div className="flex w-full max-w-md flex-col rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-ink-900 to-ink-950 p-5 shadow-2xl max-h-[80vh]">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <div className="font-display text-base font-bold text-white">👤 Push to student</div>
            <div className="text-[11px] text-ink-400 truncate">{entry.name}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-xl leading-none text-ink-400 hover:text-white">×</button>
        </div>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search students…"
          className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-white placeholder:text-ink-500 focus:border-emerald-500 focus:outline-none"
          autoFocus />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/60">
          {filtered.length === 0 ? (
            <div className="p-4 text-xs text-ink-500">No students match.</div>
          ) : (
            <div className="divide-y divide-ink-800">
              {filtered.map((s) => (
                <div key={s.userId} className="flex items-center gap-3 px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{s.name}</div>
                    <div className="truncate text-[10px] text-ink-500">@{s.username}</div>
                  </div>
                  <button onClick={() => doPush(s.userId)} disabled={busy}
                    className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-400 disabled:opacity-60">
                    Push
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {err && <div className="mt-2 text-[12px] text-rose-400">{err}</div>}
      </div>
    </div>
  );
}
