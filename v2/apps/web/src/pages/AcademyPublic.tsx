// AcademyPublic.tsx — public academy landing at /academy-page/:slug
//
// Rewrite v5 (2026-08-13, Claude-designed). Owner rejected v4 as "crappy".
// This pass: strip decorations, single accent (warm amber), editorial
// magazine feel, big elegant typography, generous whitespace. Content-first
// (photos + real copy do the heavy lifting), not decoration-first.
//
// API contract unchanged — GET /api/academy-page/:slug.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

interface Achievement { id: string; title: string; description?: string; year?: number; imageUrl?: string }
interface Testimonial { id: string; author: string; role?: string; quote: string; rating?: number; imageUrl?: string }
interface Socials { website?: string; twitter?: string; youtube?: string; instagram?: string; whatsapp?: string }
interface Profile {
  academyId: string; slug: string;
  displayName: string; tagline: string; description: string;
  logoUrl: string; coverUrl: string; themeUrl: string;
  country: string; city: string; foundedYear?: number;
  socials: Socials;
  achievements: Achievement[]; testimonials: Testimonial[];
}
interface Coach {
  userId: string; username: string; fullName: string | null;
  role: "coach" | "academy_owner"; isOwner: boolean;
  coachProfile: {
    displayName: string; tagline: string; country: string; titleClass: string;
    elo?: number; federation: string; yearsTeaching?: number;
    playingStyles: string[]; photoUrl: string;
  };
}
interface ClassRow { _id: string; title: string; coach: string; startAt: string; durationMin: number; topics?: string[] }
interface Resp {
  academy: { _id: string; slug: string; name: string; ownerId: string };
  profile: Profile;
  coaches: Coach[];
  upcomingClasses: ClassRow[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) { const e: any = new Error(`${path} -> ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

function isoToFlag(cc: string): string {
  if (!cc || cc.length !== 2) return "";
  const OFFSET = 127397;
  const chars = [...cc.toUpperCase()];
  if (!chars.every((c) => c >= "A" && c <= "Z")) return "";
  return String.fromCodePoint(...chars.map((c) => OFFSET + c.charCodeAt(0)));
}

function renderDescription(text: string): { __html: string } {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = esc.split(/\n{2,}/).map((p) => {
    const b = p.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const i = b.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    const nl = i.replace(/\n/g, "<br/>");
    return `<p class="mb-6 leading-[1.75] text-[17px] md:text-[19px] text-stone-700">${nl}</p>`;
  });
  return { __html: paragraphs.join("") };
}

function socialHref(kind: string, v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  switch (kind) {
    case "twitter":   return `https://twitter.com/${h}`;
    case "youtube":   return h.startsWith("UC") ? `https://youtube.com/channel/${h}` : `https://youtube.com/@${h}`;
    case "instagram": return `https://instagram.com/${h}`;
    case "whatsapp":  return `https://wa.me/${h.replace(/\D/g, "")}`;
    default:          return h.startsWith("http") ? h : `https://${h}`;
  }
}

function fmtWhen(iso: string): { day: string; date: string; time: string } {
  const d = new Date(iso);
  return {
    day:  d.toLocaleString(undefined, { weekday: "short" }),
    date: d.toLocaleString(undefined, { day: "2-digit", month: "short" }),
    time: d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

function InitialsAvatar({ name, className = "" }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <div className={`grid place-items-center bg-stone-200 text-stone-500 font-display ${className}`}>
      <span className="text-3xl">{initials}</span>
    </div>
  );
}

export default function AcademyPublicPage() {
  const { slug } = useParams<{ slug: string }>();

  const [scrolled, setScrolled] = useState(false);

  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; academyId?: string }>("/auth/me"),
  });
  const acadQ = useQuery({
    queryKey: ["academy-public", slug],
    queryFn: () => get<Resp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });

  const displayName = useMemo(
    () => acadQ.data?.profile.displayName || acadQ.data?.academy.name || slug || "",
    [acadQ.data, slug],
  );

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.getAttribute("class") || "";
    html.classList.remove("dark");
    html.classList.add("light");
    return () => { html.setAttribute("class", prev); };
  }, []);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 32);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  if (acadQ.isLoading || authQ.isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 grid place-items-center">
        <div className="text-sm tracking-widest text-stone-400 uppercase">Loading</div>
      </div>
    );
  }
  if ((acadQ.error as any)?.status === 404 || !acadQ.data) {
    const onCustom = typeof window !== "undefined" && !/harinitharanjith|localhost/.test(window.location.hostname);
    return (
      <div className="min-h-screen bg-stone-50 grid place-items-center px-6 text-center">
        <div>
          <div className="text-6xl mb-4">&#9822;</div>
          <h1 className="font-display text-3xl md:text-4xl text-stone-900 mb-3">Academy not found</h1>
          <p className="text-stone-500 max-w-md mx-auto mb-6">
            No academy with slug <code className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700">{slug}</code>.
          </p>
          {onCustom ? (
            <button onClick={() => window.location.reload()} className="px-6 py-3 rounded-full bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800">Retry</button>
          ) : (
            <Link to="/" className="px-6 py-3 rounded-full bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800">Back home</Link>
          )}
        </div>
      </div>
    );
  }

  const { academy, profile: p, coaches, upcomingClasses } = acadQ.data;
  const isOwner = !!authQ.data?.loggedIn && authQ.data.academyId === academy._id;

  const primaryContactHref = p.socials.whatsapp ? socialHref("whatsapp", p.socials.whatsapp)
    : p.socials.website ? socialHref("website", p.socials.website)
    : null;
  const joinHref = primaryContactHref || "#coaches";
  const joinLabel = primaryContactHref ? "Get in touch" : "Meet the coaches";
  const joinExternal = !!primaryContactHref;

  const yearsCoaching = coaches.reduce((max, c) => Math.max(max, c.coachProfile.yearsTeaching || 0), 0)
    || (p.foundedYear ? Math.max(1, new Date().getFullYear() - p.foundedYear) : 0);

  const socialsList: Array<[keyof Socials, string]> = [
    ["website",   p.socials.website   || ""],
    ["twitter",   p.socials.twitter   || ""],
    ["youtube",   p.socials.youtube   || ""],
    ["instagram", p.socials.instagram || ""],
    ["whatsapp",  p.socials.whatsapp  || ""],
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans antialiased selection:bg-amber-200 selection:text-stone-900">
      <nav className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/90 backdrop-blur-md border-b border-stone-200" : "bg-transparent"}`}>
        <div className="mx-auto max-w-6xl px-6 md:px-10 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-3">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-stone-200" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-amber-500 grid place-items-center text-white font-display text-sm">
                {displayName[0]?.toUpperCase() || "A"}
              </div>
            )}
            <span className="font-display text-lg tracking-tight text-stone-900">{displayName}</span>
          </a>
          <div className="flex items-center gap-2">
            {isOwner && (
              <Link to="/academy-profile/edit" className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-stone-500 hover:text-stone-900">
                Edit
              </Link>
            )}
            <a
              href={joinHref}
              {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-stone-900 text-white hover:bg-amber-600 transition-colors"
            >
              {joinLabel}
            </a>
          </div>
        </div>
      </nav>

      <header id="top" className="pt-32 md:pt-40 pb-16 md:pb-24">
        <div className="mx-auto max-w-6xl px-6 md:px-10 grid md:grid-cols-[1.15fr_1fr] gap-12 md:gap-16 items-center">
          <div>
            <div className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-stone-500 mb-6">
              {isoToFlag(p.country) && <span className="text-base leading-none">{isoToFlag(p.country)}</span>}
              <span>{p.city || "Online"}</span>
              {p.foundedYear && <><span className="text-stone-300">&middot;</span><span>Est. {p.foundedYear}</span></>}
            </div>
            <h1 className="font-display text-5xl md:text-6xl lg:text-[80px] leading-[0.98] tracking-[-0.02em] text-stone-900 mb-6">
              {displayName}
            </h1>
            {p.tagline && (
              <p className="text-xl md:text-2xl text-stone-500 leading-[1.4] max-w-xl mb-10">{p.tagline}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={joinHref}
                {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-stone-900 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
              >
                {joinLabel}
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </a>
              <a href="#coaches" className="inline-flex items-center gap-1 px-6 py-3.5 text-sm font-medium text-stone-700 hover:text-stone-900">
                Meet the coaches &rarr;
              </a>
            </div>
          </div>
          <div className="relative">
            {p.coverUrl ? (
              <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-stone-200">
                <img src={p.coverUrl} alt={displayName} className="w-full h-full object-cover" />
                <div className="absolute inset-0 ring-1 ring-inset ring-stone-900/5 rounded-[2rem]" />
              </div>
            ) : (
              <div className="relative aspect-[4/5] rounded-[2rem] bg-gradient-to-br from-amber-100 via-stone-100 to-amber-50 grid place-items-center">
                <div className="text-9xl text-stone-400/70">&#9822;</div>
              </div>
            )}
            <div className="absolute -bottom-4 -left-4 md:-bottom-5 md:-left-5 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] px-4 py-3 flex items-center gap-3 ring-1 ring-stone-100">
              <div className="w-9 h-9 rounded-xl bg-amber-500 grid place-items-center text-white text-lg">&#9823;</div>
              <div>
                <div className="text-[10px] tracking-widest uppercase text-stone-400">Coaches</div>
                <div className="text-sm font-semibold text-stone-900">{coaches.length} on staff</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 md:px-10 py-8 md:py-10 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-4 text-center md:text-left">
          {[
            { k: coaches.length, l: coaches.length === 1 ? "Coach" : "Coaches" },
            { k: yearsCoaching || (p.foundedYear ? new Date().getFullYear() - p.foundedYear : "-"), l: "Years teaching" },
            { k: p.achievements.length, l: "Achievements" },
            { k: upcomingClasses.length || 0, l: "Classes ahead" },
          ].map((s, i) => (
            <div key={i} className="md:border-l md:border-stone-200 md:pl-6 first:border-l-0 first:pl-0">
              <div className="font-display text-4xl md:text-5xl text-stone-900 tracking-tight leading-none">{s.k}</div>
              <div className="text-xs md:text-sm tracking-widest uppercase text-stone-400 mt-2">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="coaches" className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6 md:px-10">
          <div className="mb-12 md:mb-16 max-w-2xl">
            <div className="text-xs tracking-[0.2em] uppercase text-amber-600 font-semibold mb-3">Our roster</div>
            <h2 className="font-display text-4xl md:text-5xl tracking-tight text-stone-900 leading-[1.05]">
              Coaches you can count on.
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {coaches.map((c) => {
              const cp = c.coachProfile;
              const styles = cp.playingStyles?.slice(0, 3) ?? [];
              return (
                <Link
                  key={c.userId}
                  to={`/coach/${encodeURIComponent(c.username)}`}
                  className="group flex bg-white rounded-3xl overflow-hidden ring-1 ring-stone-200 hover:ring-amber-500 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.1)] transition-all"
                >
                  <div className="w-32 md:w-40 aspect-square shrink-0 bg-stone-100 overflow-hidden">
                    {cp.photoUrl ? (
                      <img src={cp.photoUrl} alt={cp.displayName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <InitialsAvatar name={cp.displayName || c.username} className="w-full h-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 p-5 md:p-6 flex flex-col justify-center">
                    <div className="flex items-center gap-2 text-xs tracking-widest uppercase text-stone-400 mb-2">
                      {cp.titleClass && <span className="font-semibold text-amber-600">{cp.titleClass}</span>}
                      {isoToFlag(cp.country) && <span className="text-base leading-none">{isoToFlag(cp.country)}</span>}
                      {cp.elo != null && <><span className="text-stone-300">&middot;</span><span>{cp.elo}</span></>}
                    </div>
                    <div className="font-display text-xl md:text-2xl text-stone-900 truncate leading-tight mb-1">
                      {cp.displayName || c.fullName || c.username}
                    </div>
                    {cp.tagline && <div className="text-sm text-stone-500 line-clamp-2 mb-3">{cp.tagline}</div>}
                    {styles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {styles.map((s) => (
                          <span key={s} className="text-[10px] tracking-wider uppercase px-2 py-1 rounded-full bg-stone-100 text-stone-600 font-medium">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
          {coaches.length === 0 && (
            <div className="text-center py-16 text-stone-400 text-sm">Coach profiles coming soon.</div>
          )}
        </div>
      </section>

      {p.description && (
        <section id="about" className="py-20 md:py-28 bg-white border-y border-stone-200">
          <div className="mx-auto max-w-6xl px-6 md:px-10 grid md:grid-cols-[1fr_1.4fr] gap-12 md:gap-20 items-start">
            <div className="md:sticky md:top-24">
              <div className="text-xs tracking-[0.2em] uppercase text-amber-600 font-semibold mb-3">About</div>
              <h2 className="font-display text-4xl md:text-5xl tracking-tight text-stone-900 leading-[1.05]">
                Chess, taught with care.
              </h2>
              <div className="mt-8 flex items-center gap-3 text-sm text-stone-500">
                <div className="w-10 h-px bg-stone-300" />
                <span>Since {p.foundedYear || "day one"}</span>
              </div>
            </div>
            <div dangerouslySetInnerHTML={renderDescription(p.description)} />
          </div>
        </section>
      )}

      {p.achievements.length > 0 && (
        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6 md:px-10">
            <div className="mb-12 md:mb-16 flex items-end justify-between gap-6 flex-wrap">
              <div>
                <div className="text-xs tracking-[0.2em] uppercase text-amber-600 font-semibold mb-3">Milestones</div>
                <h2 className="font-display text-4xl md:text-5xl tracking-tight text-stone-900 leading-[1.05]">
                  What our students have won.
                </h2>
              </div>
              <div className="text-sm text-stone-400 tracking-widest uppercase">
                {p.achievements.length} highlight{p.achievements.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {p.achievements.map((a) => (
                <div key={a.id} className="bg-white rounded-3xl overflow-hidden ring-1 ring-stone-200 hover:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.1)] transition-shadow group">
                  {a.imageUrl && (
                    <div className="aspect-[4/3] bg-stone-100 overflow-hidden">
                      <img src={a.imageUrl} alt={a.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                    </div>
                  )}
                  <div className="p-6">
                    {a.year && <div className="text-xs tracking-widest uppercase text-amber-600 font-semibold mb-2">{a.year}</div>}
                    <div className="font-display text-xl text-stone-900 leading-tight mb-2">{a.title}</div>
                    {a.description && <p className="text-sm text-stone-500 leading-relaxed">{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {p.testimonials.length > 0 && (
        <section className="py-20 md:py-28 bg-white border-y border-stone-200">
          <div className="mx-auto max-w-6xl px-6 md:px-10">
            <div className="mb-12 md:mb-16 max-w-2xl">
              <div className="text-xs tracking-[0.2em] uppercase text-amber-600 font-semibold mb-3">Testimonials</div>
              <h2 className="font-display text-4xl md:text-5xl tracking-tight text-stone-900 leading-[1.05]">
                Words from our students.
              </h2>
            </div>
            <div className="grid gap-8 md:grid-cols-2">
              {p.testimonials.slice(0, 4).map((t) => (
                <figure key={t.id} className="bg-stone-50 rounded-3xl p-8 md:p-10 ring-1 ring-stone-200">
                  <div className="text-6xl text-amber-500 leading-none mb-3 font-display">&ldquo;</div>
                  <blockquote className="font-display text-xl md:text-2xl leading-[1.4] text-stone-800 mb-6">
                    {t.quote}
                  </blockquote>
                  <figcaption className="flex items-center gap-3">
                    {t.imageUrl ? (
                      <img src={t.imageUrl} alt={t.author} className="w-11 h-11 rounded-full object-cover ring-1 ring-stone-200" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-amber-500 grid place-items-center text-white font-display text-sm">
                        {t.author.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{t.author}</div>
                      {t.role && <div className="text-xs text-stone-500">{t.role}</div>}
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {upcomingClasses.length > 0 && (
        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-6 md:px-10">
            <div className="mb-12 md:mb-16 max-w-2xl">
              <div className="text-xs tracking-[0.2em] uppercase text-amber-600 font-semibold mb-3">On the calendar</div>
              <h2 className="font-display text-4xl md:text-5xl tracking-tight text-stone-900 leading-[1.05]">
                Upcoming classes.
              </h2>
            </div>
            <div className="divide-y divide-stone-200 border-y border-stone-200 bg-white rounded-3xl overflow-hidden">
              {upcomingClasses.map((cl) => {
                const w = fmtWhen(cl.startAt);
                return (
                  <div key={cl._id} className="flex items-center gap-5 md:gap-8 px-5 md:px-8 py-6 hover:bg-amber-50/40 transition-colors">
                    <div className="text-center shrink-0 w-16 md:w-20">
                      <div className="text-[10px] tracking-widest uppercase text-amber-600 font-semibold">{w.day}</div>
                      <div className="font-display text-2xl md:text-3xl text-stone-900 leading-none mt-1">{w.date}</div>
                      <div className="text-xs text-stone-500 mt-1">{w.time}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-lg md:text-xl text-stone-900 truncate">{cl.title}</div>
                      <div className="text-sm text-stone-500 mt-0.5">
                        with {cl.coach || "coach"} &middot; {cl.durationMin} min
                        {cl.topics && cl.topics.length > 0 && <> &middot; {cl.topics.slice(0, 2).join(" &middot; ")}</>}
                      </div>
                    </div>
                    <a
                      href={joinHref}
                      {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-stone-700 hover:text-amber-600 transition-colors"
                    >
                      RSVP &rarr;
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="py-24 md:py-32 bg-stone-900 text-white">
        <div className="mx-auto max-w-4xl px-6 md:px-10 text-center">
          <h2 className="font-display text-4xl md:text-6xl tracking-tight leading-[1.05] mb-6">
            Ready to move your first piece?
          </h2>
          <p className="text-lg md:text-xl text-stone-400 max-w-xl mx-auto mb-10">
            Whether you are new to the game or reaching for your next title,
            we will meet you where you are.
          </p>
          <a
            href={joinHref}
            {...(joinExternal ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-amber-500 text-stone-900 text-base font-semibold hover:bg-amber-400 transition-colors"
          >
            {joinLabel}
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
        </div>
      </section>

      <footer className="py-10 md:py-12 bg-stone-950 text-stone-400 text-sm">
        <div className="mx-auto max-w-6xl px-6 md:px-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-amber-500 grid place-items-center text-stone-900 font-display text-xs">
                {displayName[0]?.toUpperCase() || "A"}
              </div>
            )}
            <span className="font-display text-white">{displayName}</span>
            {p.city && <span className="text-stone-600 hidden sm:inline">&middot; {p.city}</span>}
          </div>
          <div className="flex items-center gap-4">
            {socialsList.filter(([, v]) => v).map(([k, v]) => (
              <a key={k} href={socialHref(k, v)} target="_blank" rel="noreferrer" className="hover:text-white transition-colors capitalize text-xs tracking-widest uppercase">
                {k}
              </a>
            ))}
          </div>
          <div className="text-xs text-stone-600">Powered by ChessGuru</div>
        </div>
      </footer>
    </div>
  );
}
