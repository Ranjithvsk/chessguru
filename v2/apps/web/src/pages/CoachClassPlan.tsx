// Class-plan generator draft — one weakness in, a 5-section lesson plan out.
// Route: /coach-board/plan/:tag
//
// Sections mirror a real 45-min class:
//   1. Warm-up (5 min): puzzle theme
//   2. Teach (15 min): book chapters
//   3. Demo positions (10 min): actual student mistakes
//   4. Practice (10 min): coach's own studies
//   5. Homework: puzzle drill target

import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { coachBoardApi } from "../lib/coach-board-api";

export default function CoachClassPlanPage() {
  const { tag = "" } = useParams<{ tag: string }>();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const q = useQuery({
    queryKey: ["coach-plan", tag],
    queryFn: () => coachBoardApi.plan(tag),
    enabled: !!auth?.loggedIn && !!tag,
  });

  if (auth && !auth.loggedIn) return <Navigate to={`/login?back=/coach-board/plan/${encodeURIComponent(tag)}`} replace />;
  if (q.isLoading) return <div className="mx-auto max-w-4xl px-3 py-8 text-sm text-ink-400">Generating plan…</div>;
  if (q.error) return <div className="mx-auto max-w-4xl px-3 py-8">
    <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message || q.error)}</div>
    <Link to="/coach-board" className="mt-3 inline-block text-sm text-brand-300 hover:underline">← Class board</Link>
  </div>;
  if (!q.data) return null;

  const p = q.data;

  return (
    <div className="mx-auto max-w-4xl px-3 py-6">
      <Link to="/coach-board" className="mb-3 inline-block text-xs text-ink-400 hover:text-ink-200">← Class board</Link>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-brand-200">Class plan draft</div>
        <h1 className="font-display text-2xl text-white">{p.label}</h1>
        <p className="text-sm text-ink-400">{p.studentsAffected} student{p.studentsAffected === 1 ? "" : "s"} affected — this covers the most-needed weakness right now.</p>
      </div>

      {/* 1. Warm-up */}
      <PlanSection num="1" mins="5" title="Warm-up drill" icon="🔥">
        {p.warmUp.puzzleCount > 0 ? (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3 flex items-center gap-3">
            <div className="text-3xl">🧩</div>
            <div className="flex-1">
              <div className="font-semibold text-white">5 {p.warmUp.theme} puzzles</div>
              <div className="text-xs text-ink-400">Pull from our {p.warmUp.puzzleCount.toLocaleString()} {p.warmUp.theme}-tagged puzzles</div>
            </div>
            <Link to={`/puzzles?theme=${encodeURIComponent(p.warmUp.theme)}`}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">Open →</Link>
          </div>
        ) : <EmptyRow>No puzzle theme mapped for this weakness.</EmptyRow>}
      </PlanSection>

      {/* 2. Teach */}
      <PlanSection num="2" mins="15" title="Teach — book chapters" icon="📚">
        {p.teach.books.length > 0 ? (
          <div className="space-y-2">
            {p.teach.books.map((b) => (
              <Link key={b.bookId} to={`/books/${encodeURIComponent(b.bookId)}`}
                className="block rounded-lg border border-ink-700 bg-ink-900 p-3 hover:bg-ink-800">
                <div className="text-sm font-semibold text-white">{b.title}</div>
                <div className="text-xs text-ink-500">{b.author}</div>
                <div className="mt-1 text-xs">
                  {b.chapters.map((c) => (
                    <span key={c.number} className="mr-2 rounded-full bg-ink-800 px-2 py-0.5 text-ink-200">
                      Ch{c.number} · {c.title}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        ) : <EmptyRow>No matching book chapters in your library.</EmptyRow>}
      </PlanSection>

      {/* 3. Demo positions from real student games */}
      <PlanSection num="3" mins="10" title="Demo — from your students' games" icon="🎯">
        {p.demoPositions.length > 0 ? (
          <div className="space-y-2">
            {p.demoPositions.map((d, i) => (
              <div key={i} className="rounded-lg border border-ink-700 bg-ink-900 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-white">{d.studentName}</span>
                  <span className="text-ink-500">— move {Math.ceil(d.ply / 2)}</span>
                  <span className="font-mono text-rose-300">{d.san}</span>
                  <span className="text-ink-500">→ best was</span>
                  <span className="font-mono text-emerald-300">{d.bestSan}</span>
                </div>
                {d.explanation && <div className="mt-1 text-xs text-ink-400">{d.explanation}</div>}
                <div className="mt-2 flex gap-2">
                  <Link to={`/my-games/${encodeURIComponent(d.gameId)}`}
                    className="text-xs text-brand-300 hover:underline">Open the game →</Link>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyRow>No student mistakes with this tag yet — the class hasn't had this pattern come up.</EmptyRow>}
      </PlanSection>

      {/* 4. Practice — your own studies */}
      <PlanSection num="4" mins="10" title="Practice — your studies" icon="🔁">
        {p.practice.studyIds.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {p.practice.studyIds.map((sid) => (
              <Link key={sid} to={`/studies/${encodeURIComponent(sid)}`}
                className="block rounded-lg border border-ink-700 bg-ink-900 p-3 text-sm text-white hover:bg-ink-800">
                📓 Open study
              </Link>
            ))}
          </div>
        ) : (
          <EmptyRow>
            No matching studies of your own yet. <Link to="/studies/new" className="text-brand-300 hover:underline">Create one</Link>.
          </EmptyRow>
        )}
      </PlanSection>

      {/* 5. Homework */}
      <PlanSection num="5" mins="—" title="Homework" icon="📮">
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-3 flex items-center gap-3">
          <div className="text-3xl">🎯</div>
          <div className="flex-1 text-sm text-white">
            {p.homework.targetCount} {p.homework.puzzleTheme || "themed"} puzzles by next class.
          </div>
          {p.homework.puzzleTheme && (
            <Link to={`/puzzles?theme=${encodeURIComponent(p.homework.puzzleTheme)}`}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">Assign →</Link>
          )}
        </div>
      </PlanSection>

      <div className="mt-8 rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 text-sm text-ink-300">
        <div className="mb-1 font-semibold text-brand-200">This is a draft.</div>
        Edit any section by opening the linked items directly. Turning this into a scheduled class + assigning as homework is a future add.
      </div>
    </div>
  );
}

function PlanSection({ num, mins, title, icon, children }: { num: string; mins: string; title: string; icon: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{num}</div>
        <div className="text-lg font-semibold text-white">{icon} {title}</div>
        <div className="ml-auto text-xs text-ink-500">{mins} min</div>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-ink-700 p-3 text-center text-xs text-ink-500">{children}</div>;
}
