// Fees → Programs (W1)
//
// Owner creates + browses fee programs. Each program is a named container of
// heads (Tuition, Exam, Book, Late, Other). Later weeks add plans + enrollments
// + invoices + payments — this screen is just the schema-first step.
//
// Design principles applied (from CHESSGURU-FEES-WORLD-CLASS §Design Principles):
//   * All 4 states designed together — loading skeleton, empty (with SVG hint),
//     error, populated. No blank pages.
//   * i18n-ready — every user-facing string is a `t(...)` call so we can wire
//     react-intl in M4 without touching UI code.
//   * ≥ 44 × 44 px touch targets on the primary CTAs.
//   * Currency via Intl.NumberFormat(en-IN) — no hand-rolled formatting.
//   * Optimistic invalidation after create — the new row appears immediately.
//
// UI language: existing brand.500 (indigo) primary, accent.500 (emerald) for
// paid/success chips, gold.500 for attention. No new libs; framer-motion +
// recharts land in W4/W3 respectively. Every interaction so far is CSS.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feesApi, fmtRupees, parseRupeesInput, type CreateProgramInput, type FeeHeadKind, type ProgramResponse } from "../lib/fees-api";

// Trivial in-file i18n placeholder — replaced by react-intl in M4. Keeps every
// string discoverable via `t(` so the extraction script picks them all up.
const t = (s: string) => s;

const KIND_META: Record<FeeHeadKind, { label: string; emoji: string; ring: string }> = {
  TUITION:  { label: "Tuition",  emoji: "🎓", ring: "ring-brand-400/40 bg-brand-500/10 text-brand-200" },
  EXAM:     { label: "Exam",     emoji: "📝", ring: "ring-gold-400/40 bg-gold-500/10 text-gold-400" },
  BOOK:     { label: "Book",     emoji: "📘", ring: "ring-accent-400/40 bg-accent-500/10 text-accent-400" },
  LATE:     { label: "Late fee", emoji: "⏰", ring: "ring-red-400/40 bg-red-500/10 text-red-300" },
  OTHER:    { label: "Other",    emoji: "✨", ring: "ring-ink-500/40 bg-ink-800/60 text-ink-200" },
};

export default function FeesProgramsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [q, setQ] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["fees.programs", { q }],
    queryFn: () => feesApi.listPrograms({ q: q.trim() || undefined }),
  });

  const programs = data?.programs ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">
              {t("Beta · W1")}
            </span>
            <button onClick={() => nav("/fees")} className="text-xs text-ink-300 hover:text-white">
              {t("← Fees")}
            </button>
          </div>
          <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">
            {t("Fee programs")}
          </h1>
          <p className="mt-1 max-w-lg text-sm text-ink-300">
            {t("A program is a named bundle of fee heads — Tuition, Exam, Book. Enrollments hang off programs; invoices roll up their heads.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Search programs…")}
            className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900/60 px-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:w-64"
          />
          <button
            onClick={() => setOpenCreate(true)}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <span aria-hidden>＋</span>
            {t("New program")}
          </button>
        </div>
      </header>

      {/* States: loading | error | empty | list */}
      {isLoading && <ProgramsSkeleton />}
      {isError && (
        <ErrorCard
          title={t("Couldn't load programs.")}
          hint={error instanceof Error ? error.message : t("Please try again.")}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && programs.length === 0 && (
        <EmptyState onCreate={() => setOpenCreate(true)} hasQuery={!!q.trim()} />
      )}
      {!isLoading && !isError && programs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {programs.map((p) => (
            <ProgramCard key={p.id} p={p} onOpen={() => nav(`/fees/programs/${p.id}`)} />
          ))}
        </div>
      )}

      {openCreate && (
        <CreateProgramModal
          onClose={() => setOpenCreate(false)}
          onCreated={(created) => {
            setOpenCreate(false);
            qc.invalidateQueries({ queryKey: ["fees.programs"] });
            nav(`/fees/programs/${created.id}`);
          }}
        />
      )}
    </div>
  );
}

// ---- Program card --------------------------------------------------------

function ProgramCard({ p, onOpen }: { p: ProgramResponse; onOpen: () => void }) {
  const isArchived = p.status === "ARCHIVED";
  return (
    <button
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      {/* Corner gradient */}
      <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-gradient-to-br from-brand-500/20 to-transparent blur-xl transition group-hover:from-brand-500/30" />
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-400">{isArchived ? t("Archived") : t("Active")}</div>
          <h3 className="mt-0.5 text-lg font-semibold text-ink-100">{p.name}</h3>
        </div>
        {isArchived && (
          <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-400">
            {t("hidden")}
          </span>
        )}
      </div>
      {p.description && (
        <p className="mb-4 line-clamp-2 text-sm text-ink-300">{p.description}</p>
      )}
      <div className="mt-auto flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-400">{t("Per bill")}</div>
          <div className="font-display text-2xl text-ink-100">
            {p.totalPaise > 0 ? fmtRupees(p.totalPaise) : <span className="text-ink-500">—</span>}
          </div>
        </div>
        <div className="rounded-lg bg-ink-800/60 px-3 py-1.5 text-xs text-ink-300">
          {p.headCount === 0 ? t("No heads yet") : p.headCount === 1 ? t("1 head") : `${p.headCount} ${t("heads")}`}
        </div>
      </div>
    </button>
  );
}

// ---- Empty state --------------------------------------------------------

function EmptyState({ onCreate, hasQuery }: { onCreate: () => void; hasQuery: boolean }) {
  if (hasQuery) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 text-4xl">🔍</div>
        <h3 className="text-lg font-semibold text-ink-100">{t("No matching programs")}</h3>
        <p className="mt-1 text-sm text-ink-400">{t("Try a different word, or clear the search.")}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 px-6 py-14 text-center">
      {/* Illustration — chess king on a coin */}
      <svg viewBox="0 0 96 96" className="mb-4 h-24 w-24" aria-hidden>
        <defs>
          <linearGradient id="coin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbbf24" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
          <linearGradient id="king" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a5b4fc" />
            <stop offset="1" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <ellipse cx="48" cy="82" rx="32" ry="6" fill="url(#coin)" opacity="0.85" />
        <path
          d="M48 20 v-6 M42 20 h12 M48 20 c8 6 8 14 0 20 c-8-6-8-14 0-20 z M36 46 h24 v10 c0 6-5 10-12 10 s-12-4-12-10 z M32 66 h32 v6 h-32 z"
          fill="url(#king)"
          stroke="#312e81"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      <h3 className="font-display text-xl text-ink-100">{t("No programs yet")}</h3>
      <p className="mt-2 max-w-sm text-sm text-ink-400">
        {t("Create your first fee program — a bundle of heads students will be enrolled into. You can add heads now or later.")}
      </p>
      <button
        onClick={onCreate}
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110"
      >
        <span aria-hidden>＋</span>
        {t("Create your first program")}
      </button>
    </div>
  );
}

// ---- Error card --------------------------------------------------------

function ErrorCard({ title, hint, onRetry }: { title: string; hint?: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
      <div className="mb-2 text-3xl">😬</div>
      <h3 className="text-lg font-semibold text-ink-100">{title}</h3>
      {hint && <p className="mt-1 text-sm text-ink-300">{hint}</p>}
      <button
        onClick={onRetry}
        className="mt-4 h-10 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20"
      >
        {t("Retry")}
      </button>
    </div>
  );
}

// ---- Skeleton --------------------------------------------------------

function ProgramsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
          <div className="mb-3 h-3 w-16 rounded bg-ink-700" />
          <div className="mb-2 h-5 w-40 rounded bg-ink-700" />
          <div className="mb-6 h-3 w-full rounded bg-ink-800" />
          <div className="flex justify-between">
            <div className="h-8 w-24 rounded bg-ink-700" />
            <div className="h-6 w-16 rounded bg-ink-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Create modal --------------------------------------------------------

type DraftHead = { name: string; amountRupees: string; kind: FeeHeadKind };

function CreateProgramModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProgramResponse) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [heads, setHeads] = useState<DraftHead[]>([
    { name: "Tuition", amountRupees: "", kind: "TUITION" },
  ]);
  const [err, setErr] = useState<string | null>(null);

  const total = heads.reduce((s, h) => s + (parseRupeesInput(h.amountRupees) ?? 0), 0);

  const create = useMutation({
    mutationFn: (input: CreateProgramInput) => feesApi.createProgram(input),
    onSuccess: (p) => onCreated(p),
    onError: (e) => setErr(e instanceof Error ? e.message : t("Couldn't create the program.")),
  });

  function submit() {
    setErr(null);
    if (!name.trim()) { setErr(t("Give the program a name.")); return; }
    const validHeads: NonNullable<CreateProgramInput["heads"]> = [];
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      if (!h) continue;
      const rawName = (h.name ?? "").trim();
      const rawAmount = (h.amountRupees ?? "").trim();
      if (!rawName && !rawAmount) continue;   // skip fully-empty rows
      if (!rawName) { setErr(t(`Head #${i + 1} is missing a name.`)); return; }
      const paise = parseRupeesInput(rawAmount);
      if (paise === null || paise < 1) { setErr(t(`Head "${rawName}" needs an amount (e.g. 1800).`)); return; }
      validHeads.push({ name: rawName, amountPaise: paise, kind: h.kind });
    }
    create.mutate({ name: name.trim(), description: description.trim() || undefined, heads: validHeads });
  }

  function updateHead(i: number, patch: Partial<DraftHead>) {
    setHeads((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  }
  function addHead()   { setHeads((prev) => [...prev, { name: "", amountRupees: "", kind: "OTHER" }]); }
  function removeHead(i: number) { setHeads((prev) => prev.filter((_, idx) => idx !== i)); }

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl text-ink-100">{t("New fee program")}</h2>
            <p className="mt-1 text-sm text-ink-400">{t("Bundle the heads that will appear on every invoice for this program.")}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-ink-300 hover:bg-ink-700 hover:text-white">
            ✕
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">{t("Name")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("e.g. September 2026 — Batch A")}
            maxLength={80}
            className="h-11 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">
            {t("Description")} <span className="normal-case text-ink-500">({t("optional")})</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("A one-line note visible to the coach team.")}
            rows={2}
            maxLength={400}
            className="w-full rounded-xl border border-ink-700 bg-ink-900 px-4 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </label>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-300">{t("Fee heads")}</span>
          <span className="text-xs text-ink-400">{t("Total per bill")} · <b className="text-ink-100">{fmtRupees(total)}</b></span>
        </div>

        <div className="mb-3 flex flex-col gap-2">
          {heads.map((h, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 p-2 pl-3 transition ${KIND_META[h.kind].ring}`}>
              <span className="text-lg" aria-hidden>{KIND_META[h.kind].emoji}</span>
              <input
                value={h.name}
                onChange={(e) => updateHead(i, { name: e.target.value })}
                placeholder={t("Head name")}
                className="h-9 min-w-0 flex-1 rounded-lg bg-ink-950/60 px-2 text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
              />
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2 grid place-items-center text-xs text-ink-400">₹</span>
                <input
                  value={h.amountRupees}
                  onChange={(e) => updateHead(i, { amountRupees: e.target.value.replace(/[^\d.,]/g, "") })}
                  inputMode="decimal"
                  placeholder="1800"
                  className="h-9 w-24 rounded-lg bg-ink-950/60 pl-6 pr-2 text-right text-sm text-ink-100 placeholder:text-ink-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
                />
              </div>
              <select
                value={h.kind}
                onChange={(e) => updateHead(i, { kind: e.target.value as FeeHeadKind })}
                className="h-9 rounded-lg bg-ink-950/60 px-2 text-xs text-ink-100 focus:outline-none focus:ring-1 focus:ring-brand-500/40"
              >
                {Object.entries(KIND_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <button
                onClick={() => removeHead(i)}
                className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-800 hover:text-red-300"
                aria-label={t("Remove head")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addHead}
          className="mb-5 w-full rounded-xl border border-dashed border-ink-600 py-2 text-xs font-medium text-ink-300 hover:border-brand-500/60 hover:text-brand-200"
        >
          ＋ {t("Add another head")}
        </button>

        {err && (
          <div role="alert" className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="h-11 rounded-xl px-4 text-sm font-semibold text-ink-300 hover:bg-ink-800">
            {t("Cancel")}
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            {create.isPending ? t("Creating…") : t("Create program")}
          </button>
        </div>
      </div>
    </div>
  );
}
