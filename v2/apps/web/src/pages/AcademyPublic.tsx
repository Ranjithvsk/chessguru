// AcademyPublic.tsx — public academy landing at /academy-page/:slug
//
// Chessiverse-style: full-width cover, logo circle overlapping bottom-left,
// stats bar, "Our Coaches" grid, About markdown, Achievements, Testimonials,
// Upcoming Classes, footer band. Pulls EVERYTHING in one GET so the page is
// snappy even on a cold cache. Empty sections skip entirely — never leave
// dead blocks.
//
// Palette matches CoachPublic (cyan/teal accent, slate-900 base) so a coach
// clicking through from the roster grid feels visual continuity.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useMemo } from "react";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials {
  website?: string; twitter?: string; youtube?: string; instagram?: string; whatsapp?: string;
}
interface AcademyProfile {
  academyId: string; slug: string;
  displayName: string; tagline: string; description: string;
  logoUrl: string; coverUrl: string;
  country: string; city: string; foundedYear?: number;
  socials: Socials;
  achievements: Achievement[]; testimonials: Testimonial[];
  featuredCoachIds: string[];
  customDomain: string; customDomainStatus: string;
  updatedAt: string | null;
}
interface CoachRow {
  userId: string; username: string; fullName: string | null;
  role: "coach" | "academy_owner"; isOwner: boolean;
  coachProfile: {
    displayName: string; tagline: string; country: string; titleClass: string;
    elo?: number; federation: string; yearsTeaching?: number;
    playingStyles: string[]; photoUrl: string;
  };
}
interface ClassRow {
  _id: string; title: string; coach: string; startAt: string; durationMin: number;
  coachUserId?: string | null; topics?: string[];
}
interface AcademyResp {
  academy: { _id: string; slug: string; name: string; ownerId: string };
  profile: AcademyProfile;
  coaches: CoachRow[];
  upcomingClasses: ClassRow[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) {
    const err: any = new Error(`GET ${path} → ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

function flagEmoji(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

// Same markdown-lite parser as CoachPublic — paragraphs (\n\n), **bold**,
// *italic*. Deliberately no raw-HTML support (escapes < & > first) so XSS
// surface stays minimal.
function renderDescription(text: string): { __html: string } {
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

function SocialIcon({ kind }: { kind: string }) {
  const c = "w-4 h-4";
  switch (kind) {
    case "website": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>;
    case "twitter": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.9l-4.85-6.34L4.9 22H2l7.02-8.02L1.5 2h7.1l4.4 5.85L18.244 2zm-2.42 18h1.66L7.9 4H6.2l9.624 16z"/></svg>;
    case "youtube": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 00.5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 002.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 002.1-2.1C24 16 24 12 24 12s0-4-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>;
    case "instagram": return <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>;
    case "whatsapp": return <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.5A10 10 0 1012 2zm5.5 14.3c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.7-2.8-1.1-4.5-3.9-4.6-4-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 1-2.3.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.6.7 1.9.8 2 .1.2.1.3 0 .5-.1.2-.2.3-.3.5-.2.2-.3.3-.5.5-.1.1-.3.3-.1.6.2.3.9 1.4 1.9 2.3 1.3 1.1 2.4 1.5 2.7 1.7.3.2.5.1.7-.1.2-.2.8-1 1-1.3.2-.3.4-.2.7-.1s1.9.9 2.2 1c.3.2.5.2.6.4.1.1.1.7-.1 1.4z"/></svg>;
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
    case "whatsapp": return `https://wa.me/${handle.replace(/[^0-9]/g, "")}`;
    default: return handle.startsWith("http") ? handle : `https://${handle}`;
  }
}

export default function AcademyPublicPage() {
  const { slug } = useParams<{ slug: string }>();

  // Hooks all above every early return (React #310).
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string; academyId?: string }>("/auth/me"),
  });
  const acadQ = useQuery({
    queryKey: ["academy-public", slug],
    queryFn: () => get<AcademyResp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });

  const displayName = useMemo(
    () => acadQ.data?.profile.displayName || acadQ.data?.academy.name || slug || "",
    [acadQ.data, slug],
  );

  if (acadQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-8 text-center text-ink-400">
        Loading academy…
      </div>
    );
  }
  if (acadQ.isError || !acadQ.data) {
    return (
      <div className="mx-auto max-w-3xl p-12 text-center">
        <div className="text-6xl mb-4">♟</div>
        <h1 className="text-2xl font-bold text-ink-100 mb-2">Academy not found</h1>
        <p className="text-ink-400 mb-6">
          No academy with slug <code className="text-cyan-300">{slug}</code> — or the owner hasn't set up a public page yet.
        </p>
        <Link to="/" className="inline-block px-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium">
          ← Back to ChessGuru
        </Link>
      </div>
    );
  }

  const { academy, profile: p, coaches, upcomingClasses } = acadQ.data;
  const flag = flagEmoji(p.country);
  const yearsRunning = p.foundedYear ? Math.max(0, new Date().getFullYear() - p.foundedYear) : null;
  const trophyCount = p.achievements.length;
  const stats: Array<{ label: string; value: number | string }> = [];
  if (coaches.length) stats.push({ label: "Coaches", value: coaches.length });
  if (yearsRunning != null) stats.push({ label: "Years running", value: yearsRunning });
  if (trophyCount) stats.push({ label: "Achievements", value: trophyCount });
  if (p.testimonials.length) stats.push({ label: "Happy students", value: `${p.testimonials.length}+` });

  const socialEntries: Array<[string, string]> = ([
    ["website", p.socials.website],
    ["twitter", p.socials.twitter],
    ["youtube", p.socials.youtube],
    ["instagram", p.socials.instagram],
    ["whatsapp", p.socials.whatsapp],
  ] as Array<[string, string | undefined]>).filter(([, v]) => !!v) as Array<[string, string]>;

  const isOwner = !!authQ.data?.loggedIn && authQ.data.academyId === academy._id;

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      {/* Hero */}
      <div className="relative">
        <div
          className="h-64 md:h-80 w-full bg-gradient-to-br from-cyan-800 via-teal-900 to-ink-900 bg-cover bg-center"
          style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
        />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-900 to-transparent" />
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="relative -mt-20 md:-mt-24 flex flex-col md:flex-row md:items-end gap-4 md:gap-6 pb-6">
            {/* Logo */}
            <div className="shrink-0">
              {p.logoUrl ? (
                <img
                  src={p.logoUrl} alt={displayName}
                  className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-ink-900 shadow-xl object-cover bg-ink-800"
                />
              ) : (
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-ink-900 shadow-xl bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-5xl font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {flag && <span className="text-2xl leading-none" title={p.country}>{flag}</span>}
                {p.city && <span className="text-ink-400 text-sm">{p.city}</span>}
                {p.foundedYear && (
                  <span className="text-ink-500 text-sm">· est. {p.foundedYear}</span>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">{displayName}</h1>
              {p.tagline && (
                <p className="text-ink-300 mt-1 text-sm md:text-base">{p.tagline}</p>
              )}
              {isOwner && (
                <div className="mt-3">
                  <Link
                    to="/academy-profile/edit"
                    className="text-xs text-cyan-300 hover:text-cyan-200 underline"
                  >Edit your academy page →</Link>
                </div>
              )}
            </div>
            {/* CTA cluster */}
            <div className="shrink-0 md:pb-1 flex flex-wrap gap-2">
              <Link
                to="/signup-academy"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-semibold shadow-lg shadow-cyan-500/20"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4v16m-8-8h16" stroke="currentColor" strokeWidth="2"/></svg>
                Join our Academy
              </Link>
              {(p.socials.whatsapp || p.socials.website) && (
                <a
                  href={p.socials.whatsapp ? socialHref("whatsapp", p.socials.whatsapp) : socialHref("website", p.socials.website!)}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-ink-700/70 hover:bg-ink-700 text-ink-100 font-medium"
                >Contact</a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {stats.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 md:px-8 pb-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-gradient-to-br from-cyan-900/40 to-ink-800/60 border border-cyan-800/30 p-4 text-center">
                <div className="text-2xl md:text-3xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-ink-400 mt-1 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Our Coaches — chessiverse creator grid */}
      <section className="mx-auto max-w-6xl px-4 md:px-8 py-8">
        <h2 className="text-2xl font-bold text-ink-100 mb-1">Our Coaches</h2>
        <p className="text-sm text-ink-400 mb-6">
          Learn from {coaches.length > 0 ? `${coaches.length} handpicked coach${coaches.length === 1 ? "" : "es"}` : "our team"}, each with their own style.
        </p>
        {coaches.length === 0 ? (
          <div className="rounded-xl bg-ink-800/60 border border-ink-700/60 p-8 text-center text-ink-400">
            Coaches coming soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {coaches.map((c) => {
              const cp = c.coachProfile;
              const name = cp.displayName || c.fullName || c.username;
              const cflag = flagEmoji(cp.country);
              return (
                <Link
                  key={c.userId}
                  to={`/coach/${c.username}`}
                  className="group rounded-2xl bg-ink-800/60 hover:bg-ink-800 border border-ink-700/60 hover:border-cyan-700/60 p-5 transition-colors shadow-lg flex flex-col items-center text-center"
                >
                  {cp.photoUrl ? (
                    <img
                      src={cp.photoUrl} alt={name}
                      className="w-24 h-24 rounded-full object-cover bg-ink-900 border-2 border-ink-700 group-hover:border-cyan-500"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-3xl font-bold text-white border-2 border-ink-700 group-hover:border-cyan-500">
                      {name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-3">
                    {cp.titleClass && (
                      <span className="px-1.5 py-0.5 rounded bg-yellow-500 text-black text-[10px] font-bold">{cp.titleClass}</span>
                    )}
                    <div className="font-semibold text-ink-100">{name}</div>
                    {cflag && <span className="text-base leading-none">{cflag}</span>}
                  </div>
                  {c.isOwner && (
                    <div className="text-[10px] uppercase tracking-wide text-amber-300 mt-0.5">Founder</div>
                  )}
                  {cp.tagline && (
                    <div className="text-xs text-ink-400 mt-1 line-clamp-2">{cp.tagline}</div>
                  )}
                  <div className="flex flex-wrap justify-center gap-1.5 mt-3">
                    {cp.elo && (
                      <span className="px-2 py-0.5 rounded-full bg-cyan-600/20 text-cyan-300 text-[11px] font-medium">
                        {cp.elo} Elo
                      </span>
                    )}
                    {cp.playingStyles.slice(0, 2).map((s) => (
                      <span key={s} className="px-2 py-0.5 rounded-full bg-ink-700/60 text-ink-300 text-[11px]">
                        {s}
                      </span>
                    ))}
                  </div>
                  <span className="mt-4 text-xs text-cyan-300 group-hover:text-cyan-200">
                    View profile →
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* About + upcoming (two column on md+) */}
      {(p.description || upcomingClasses.length > 0) && (
        <div className="mx-auto max-w-6xl px-4 md:px-8 pb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            {p.description && (
              <section className="bg-ink-800/50 rounded-2xl p-6 shadow-lg">
                <h2 className="text-lg font-semibold text-ink-200 mb-3">About</h2>
                <div
                  className="prose prose-invert prose-sm max-w-none text-ink-300 leading-relaxed [&_p]:mb-3 [&_p:last-child]:mb-0"
                  dangerouslySetInnerHTML={renderDescription(p.description)}
                />
              </section>
            )}
          </div>
          <div className="space-y-6">
            {upcomingClasses.length > 0 && (
              <section className="bg-ink-800/50 rounded-2xl p-6 shadow-lg">
                <h2 className="text-sm font-semibold text-ink-300 uppercase tracking-wide mb-4">
                  <span className="mr-1">📅</span> Upcoming Classes
                </h2>
                <div className="space-y-3">
                  {upcomingClasses.map((cl) => (
                    <div key={cl._id} className="rounded-xl bg-ink-900/60 p-4 border border-ink-700/60">
                      <div className="font-medium text-ink-100">{cl.title || "Chess class"}</div>
                      <div className="text-xs text-ink-400 mt-1">
                        {fmtStart(cl.startAt)} · {cl.durationMin} min
                        {cl.coach ? ` · ${cl.coach}` : ""}
                      </div>
                      {authQ.data?.loggedIn ? (
                        <Link
                          to={`/class-v2/${cl._id}?role=student`}
                          className="mt-2 inline-block text-xs text-cyan-300 hover:text-cyan-200"
                        >Join room →</Link>
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
      )}

      {/* Achievements */}
      {p.achievements.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 md:px-8 pb-8">
          <h2 className="text-xl font-bold text-ink-100 mb-4">🏆 Achievements</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {p.achievements.map((a) => (
              <div key={a.id} className="bg-ink-800/60 rounded-2xl p-4 shadow-lg hover:bg-ink-800 transition-colors">
                {a.imageUrl && (
                  <img src={a.imageUrl} alt={a.title} className="w-full h-[140px] object-cover rounded-lg mb-3 bg-ink-900" />
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink-100">{a.title}</div>
                  {a.year && (
                    <span className="shrink-0 px-2 py-0.5 rounded-md bg-amber-600/20 text-amber-300 text-xs">
                      {a.year}
                    </span>
                  )}
                </div>
                {a.description && (
                  <p className="text-sm text-ink-400 mt-2">{a.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Testimonials */}
      {p.testimonials.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 md:px-8 pb-8">
          <h2 className="text-xl font-bold text-ink-100 mb-4">💬 What our students say</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {p.testimonials.map((t) => (
              <figure key={t.id} className="bg-ink-800/60 rounded-2xl p-5 shadow-lg flex flex-col">
                {typeof t.rating === "number" && (
                  <div className="text-amber-300 text-sm mb-2" aria-label={`${t.rating} out of 5 stars`}>
                    {"★".repeat(t.rating)}<span className="text-ink-600">{"★".repeat(5 - t.rating)}</span>
                  </div>
                )}
                <blockquote className="text-ink-200 italic leading-relaxed">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  {t.imageUrl ? (
                    <img src={t.imageUrl} alt={t.author} className="w-10 h-10 rounded-full object-cover bg-ink-900" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-teal-700 grid place-items-center text-sm font-bold text-white">
                      {t.author.charAt(0).toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink-100 truncate">{t.author}</div>
                    {t.role && <div className="text-xs text-ink-400 truncate">{t.role}</div>}
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Footer band */}
      <footer className="mx-auto max-w-6xl px-4 md:px-8 pt-6 pb-8 border-t border-ink-800 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {socialEntries.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              {socialEntries.map(([kind, v]) => (
                <a
                  key={kind} href={socialHref(kind, v)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-ink-800/70 hover:bg-ink-700 text-ink-200 text-sm"
                  title={kind}
                >
                  <SocialIcon kind={kind} /> <span className="capitalize">{kind}</span>
                </a>
              ))}
            </div>
          ) : <div />}
          <Link to="/" className="text-xs text-ink-500 hover:text-ink-300">
            Powered by ChessGuru
          </Link>
        </div>
      </footer>
    </div>
  );
}
