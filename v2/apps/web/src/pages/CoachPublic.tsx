// CoachPublic.tsx — public coach profile at /coach/:username
//
// Chessiverse-inspired visual: teal accent, soft blue gradient hero,
// rounded cards, sections skipped when empty. Guest-browsable — the
// whole page renders without a session.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface TopStudent  { id: string; name: string; peakRating?: number; note?: string; imageUrl?: string }
interface Trophy      { id: string; name: string; year?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string; lichess?: string; chesscom?: string;
}
interface CoachProfile {
  userId: string;
  displayName: string; tagline: string; bio: string;
  country: string; city: string;
  titleClass: string; elo?: number; federation: string;
  yearsTeaching?: number; playingStyles: string[];
  photoUrl: string; coverUrl: string;
  achievements: Achievement[]; topStudents: TopStudent[]; trophies: Trophy[];
  socials: Socials;
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface CoachResp {
  userId: string;
  username: string;
  role: "coach" | "academy_owner";
  academyId: string | null;
  academyName: string | null;
  fullName: string | null;
  profile: CoachProfile;
}
interface ClassRow {
  _id: string; title: string; coach: string; startAt: string; durationMin: number;
  coachUserId?: string; academyId?: string | null;
}
interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) {
    const err: any = new Error(`GET ${path} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

// ISO-3166 alpha-2 → flag emoji (regional indicator symbols).
function flagEmoji(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

// Tiny markdown-lite parser. Supports paragraphs (\n\n), **bold**, *italic*.
// Deliberately does NOT accept raw HTML — we escape angle brackets first,
// then apply narrow tag substitutions. Keeps XSS surface flat.
function renderBio(text: string): { __html: string } {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = esc.split(/\n{2,}/).map((p) => {
    const withBold = p.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const withItalic = withBold.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    const withBreaks = withItalic.replace(/\n/g, "<br/>");
    return `<p>${withBreaks}</p>`;
  });
  return { __html: paragraphs.join("\n") };
}

function fmtStart(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Icon component — inline SVGs for socials (no icon lib dep).
function SocialIcon({ kind }: { kind: string }) {
  const c = "w-4 h-4";
  switch (kind) {
    case "website": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>;
    case "twitter": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.9l-4.85-6.34L4.9 22H2l7.02-8.02L1.5 2h7.1l4.4 5.85L18.244 2zm-2.42 18h1.66L7.9 4H6.2l9.624 16z"/></svg>;
    case "youtube": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 00.5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 002.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 002.1-2.1C24 16 24 12 24 12s0-4-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>;
    case "instagram": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>;
    case "lichess": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M8 8h8v8H8z" fill="none" stroke="currentColor" strokeWidth="2"/></svg>;
    case "chesscom": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M8 6l4 4-4 4M16 6l-4 4 4 4" stroke="currentColor" strokeWidth="2" fill="none"/></svg>;
    default: return null;
  }
}
function socialHref(kind: string, v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "twitter": return `https://twitter.com/${handle}`;
    case "youtube": return handle.startsWith("UC") ? `https://youtube.com/channel/${handle}` : `https://youtube.com/@${handle}`;
    case "instagram": return `https://instagram.com/${handle}`;
    case "lichess": return `https://lichess.org/@/${handle}`;
    case "chesscom": return `https://chess.com/member/${handle}`;
    default: return handle.startsWith("http") ? handle : `https://${handle}`;
  }
}

export default function CoachPublicPage() {
  const { username } = useParams<{ username: string }>();
  // Hooks first — auth-me is optional (guest browsing is a value prop) but the
  // "Join" CTA on upcoming classes wants to know if the visitor is signed in.
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string }>("/auth/me"),
  });
  const coachQ = useQuery({
    queryKey: ["coach-public", username],
    queryFn: () => get<CoachResp>(`/api/coach/${encodeURIComponent(username || "")}`),
    enabled: !!username,
    retry: false,
  });
  // Upcoming classes filtered to THIS coach — pulled from the shared schedule
  // endpoint that already respects academy scope. If the call 401s (not signed
  // in) we simply render zero — the coach page still works.
  const scheduleQ = useQuery({
    queryKey: ["coach-schedule", coachQ.data?.userId, coachQ.data?.academyId],
    queryFn: () => get<ScheduleResp>("/api/class/schedule").catch(() => ({ live: [], upcoming: [] })),
    enabled: !!coachQ.data?.userId,
    retry: false,
  });

  const coachUserId = coachQ.data?.userId;
  const upcoming = useMemo(() => {
    const rows = [
      ...(scheduleQ.data?.live || []),
      ...(scheduleQ.data?.upcoming || []),
    ];
    if (!coachUserId) return [];
    return rows
      .filter((r) => r.coachUserId === coachUserId || r.coach === coachQ.data?.username)
      .slice(0, 3);
  }, [scheduleQ.data, coachUserId, coachQ.data?.username]);

  if (coachQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-8 text-center text-slate-400">
        Loading coach profile…
      </div>
    );
  }
  if (coachQ.isError || !coachQ.data) {
    return (
      <div className="mx-auto max-w-3xl p-12 text-center">
        <div className="text-6xl mb-4">♟</div>
        <h1 className="text-2xl font-bold text-slate-100 mb-2">Coach not found</h1>
        <p className="text-slate-400 mb-6">
          No coach with that username exists — or they haven't set up a public page yet.
        </p>
        <Link to="/" className="inline-block px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium">
          ← Back to ChessGuru
        </Link>
      </div>
    );
  }

  const c = coachQ.data;
  const p = c.profile;
  const displayName = p.displayName || c.fullName || c.username;
  const flag = flagEmoji(p.country);
  const stats = [
    p.yearsTeaching != null && p.yearsTeaching > 0 ? { label: "Years teaching", value: p.yearsTeaching } : null,
    p.topStudents.length > 0 ? { label: "Students", value: p.topStudents.length } : null,
    p.trophies.length > 0 ? { label: "Trophies", value: p.trophies.length } : null,
    p.elo ? { label: "Peak Elo", value: p.elo } : null,
  ].filter(Boolean) as Array<{ label: string; value: number }>;

  const socialEntries: Array<[string, string]> = ([
    ["website", p.socials.website],
    ["twitter", p.socials.twitter],
    ["youtube", p.socials.youtube],
    ["instagram", p.socials.instagram],
    ["lichess", p.socials.lichess],
    ["chesscom", p.socials.chesscom],
  ] as Array<[string, string | undefined]>).filter(([, v]) => !!v) as Array<[string, string]>;

  const isMe = !!authQ.data?.loggedIn && authQ.data.username === c.username;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Hero */}
      <div className="relative">
        <div
          className="h-64 md:h-80 w-full bg-gradient-to-br from-cyan-800 via-teal-900 to-slate-900 bg-cover bg-center"
          style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent" />
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="relative -mt-20 md:-mt-24 flex flex-col md:flex-row md:items-end gap-4 md:gap-6 pb-6">
            {/* Photo */}
            <div className="shrink-0">
              {p.photoUrl ? (
                <img
                  src={p.photoUrl} alt={displayName}
                  className="w-36 h-36 md:w-44 md:h-44 rounded-full border-4 border-slate-900 shadow-xl object-cover bg-slate-800"
                />
              ) : (
                <div className="w-36 h-36 md:w-44 md:h-44 rounded-full border-4 border-slate-900 shadow-xl bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-5xl font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {/* Name row */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {p.titleClass && (
                  <span className="px-2 py-0.5 rounded-md bg-yellow-500 text-black text-xs font-bold tracking-wide">
                    {p.titleClass}
                  </span>
                )}
                {flag && <span className="text-2xl leading-none" title={p.country}>{flag}</span>}
                {p.city && <span className="text-slate-400 text-sm">{p.city}</span>}
                {c.academyName && (
                  <span className="text-slate-500 text-sm">· {c.academyName}</span>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">{displayName}</h1>
              {p.tagline && (
                <p className="text-slate-300 mt-1 text-sm md:text-base">{p.tagline}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {p.elo && (
                  <span className="px-3 py-1 rounded-full bg-slate-800 text-cyan-300 text-xs font-semibold">
                    FIDE {p.elo}{p.federation ? ` · ${p.federation}` : ""}
                  </span>
                )}
                {isMe && (
                  <Link
                    to="/coach-profile/edit"
                    className="ml-auto text-xs text-cyan-300 hover:text-cyan-200 underline"
                  >
                    Edit your profile →
                  </Link>
                )}
              </div>
            </div>
            {/* CTA */}
            <div className="shrink-0 md:pb-1">
              <Link
                to="/play"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold shadow-lg shadow-cyan-500/20"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Play Free with Me
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 md:px-8 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: bio + styles + socials */}
        <div className="md:col-span-2 space-y-6">
          {p.bio && (
            <section className="bg-slate-800/50 rounded-2xl p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-200 mb-3">About</h2>
              <div
                className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0"
                dangerouslySetInnerHTML={renderBio(p.bio)}
              />
            </section>
          )}
          {p.playingStyles.length > 0 && (
            <section className="bg-slate-800/50 rounded-2xl p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-200 mb-3">Playing style</h2>
              <div className="flex flex-wrap gap-2">
                {p.playingStyles.map((s) => (
                  <span key={s} className="px-3 py-1.5 rounded-full bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 text-sm">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}
          {socialEntries.length > 0 && (
            <section className="bg-slate-800/50 rounded-2xl p-6 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-200 mb-3">Find me on</h2>
              <div className="flex flex-wrap gap-3">
                {socialEntries.map(([kind, v]) => (
                  <a
                    key={kind} href={socialHref(kind, v)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-sm"
                    title={kind}
                  >
                    <SocialIcon kind={kind} /> <span className="capitalize">{kind}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
        {/* Right column: stats */}
        <div className="space-y-6">
          {stats.length > 0 && (
            <section className="bg-gradient-to-br from-cyan-900/50 to-slate-800/50 rounded-2xl p-6 shadow-lg border border-cyan-800/40">
              <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-wide mb-4">Stats</h2>
              <div className="grid grid-cols-2 gap-4">
                {stats.map((s) => (
                  <div key={s.label}>
                    <div className="text-2xl font-bold text-white">{s.value}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {upcoming.length > 0 && (
            <section className="bg-slate-800/50 rounded-2xl p-6 shadow-lg">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">
                <span className="mr-1">📅</span> Upcoming Classes
              </h2>
              <div className="space-y-3">
                {upcoming.map((cl) => (
                  <div key={cl._id} className="rounded-xl bg-slate-900/60 p-4 border border-slate-700/60">
                    <div className="font-medium text-slate-100">{cl.title}</div>
                    <div className="text-xs text-slate-400 mt-1">{fmtStart(cl.startAt)} · {cl.durationMin} min</div>
                    {authQ.data?.loggedIn ? (
                      <Link
                        to={`/class-v2/${cl._id}?role=student`}
                        className="mt-2 inline-block text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        Join room →
                      </Link>
                    ) : (
                      <Link to="/login" className="mt-2 inline-block text-xs text-cyan-300 hover:text-cyan-200">
                        Sign in to join →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Achievements */}
      {p.achievements.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 md:px-8 pb-8">
          <h2 className="text-xl font-bold text-slate-100 mb-4">🏆 Achievements</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {p.achievements.map((a) => (
              <div key={a.id} className="bg-slate-800/60 rounded-2xl p-4 shadow-lg hover:bg-slate-800 transition-colors">
                {a.imageUrl && (
                  <img src={a.imageUrl} alt={a.title} className="w-full h-[140px] object-cover rounded-lg mb-3 bg-slate-900" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-100">{a.title}</div>
                  {a.year && (
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-600/20 text-amber-300 text-xs">
                      {a.year}
                    </span>
                  )}
                </div>
                {a.description && (
                  <p className="text-sm text-slate-400 mt-2">{a.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Students */}
      {p.topStudents.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 md:px-8 pb-8">
          <h2 className="text-xl font-bold text-slate-100 mb-4">🎓 Top Students</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {p.topStudents.map((s) => (
              <div key={s.id} className="bg-slate-800/60 rounded-2xl p-4 shadow-lg flex gap-3 items-start">
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt={s.name} className="w-16 h-16 rounded-full object-cover shrink-0 bg-slate-900" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-xl font-bold text-white shrink-0">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-100">{s.name}</div>
                  {s.peakRating && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-cyan-600/20 text-cyan-300 text-xs">
                      Peak {s.peakRating}
                    </span>
                  )}
                  {s.note && <p className="text-sm text-slate-400 mt-2">{s.note}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trophies */}
      {p.trophies.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 md:px-8 pb-12">
          <h2 className="text-xl font-bold text-slate-100 mb-4">🏅 Trophies</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {p.trophies.map((t) => (
              <div key={t.id} className="bg-slate-800/60 rounded-2xl p-3 shadow-lg text-center">
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt={t.name} className="w-full aspect-square object-cover rounded-lg mb-2 bg-slate-900" />
                ) : (
                  <div className="w-full aspect-square rounded-lg mb-2 bg-gradient-to-br from-amber-500 to-yellow-700 grid place-items-center text-4xl">
                    🏅
                  </div>
                )}
                <div className="text-sm font-medium text-slate-100 truncate">{t.name}</div>
                {t.year && <div className="text-xs text-slate-400 mt-0.5">{t.year}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mx-auto max-w-6xl px-4 md:px-8 pb-8 pt-4 text-center text-xs text-slate-500 border-t border-slate-800">
        <Link to="/" className="hover:text-slate-300">Powered by ChessGuru</Link>
      </div>
    </div>
  );
}
