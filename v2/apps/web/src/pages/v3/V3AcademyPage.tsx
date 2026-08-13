// V3AcademyPage — chessiverse-styled academy landing at /v3/academy/:slug
//
// Reads the SAME /api/academy-page/:slug endpoint that v2's AcademyPublic
// hits; renders everything in the new light palette. No new API calls.
//
// All hooks BEFORE any early return (React #310, standing rule).

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import V3Layout from "../../components/v3/V3Layout";
import V3Section from "../../components/v3/V3Section";
import V3Card from "../../components/v3/V3Card";
import V3StatTile from "../../components/v3/V3StatTile";
import V3Button from "../../components/v3/V3Button";
import V3CoachCard from "../../components/v3/V3CoachCard";

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

// Same markdown-lite parser as CoachPublic/AcademyPublic — paragraphs,
// **bold**, *italic*. Escapes < > first so XSS surface stays flat.
function renderDescription(text: string): { __html: string } {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = esc.split(/\n{2,}/).map((p) => {
    const withBold = p.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const withItalic = withBold.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return `<p style="margin:0 0 12px;">${withItalic.replace(/\n/g, "<br/>")}</p>`;
  });
  return { __html: paragraphs.join("\n") };
}

function fmtStart(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function V3AcademyPage() {
  const { slug } = useParams<{ slug: string }>();

  // All hooks BEFORE any early return.
  const acadQ = useQuery({
    queryKey: ["academy-public-v3", slug],
    queryFn: () => get<AcademyResp>(`/api/academy-page/${encodeURIComponent(slug || "")}`),
    enabled: !!slug,
    retry: false,
  });
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; academyId?: string }>("/auth/me").catch(() => ({ loggedIn: false })),
    retry: false,
  });

  const displayName = useMemo(
    () => acadQ.data?.profile.displayName || acadQ.data?.academy.name || slug || "",
    [acadQ.data, slug],
  );

  if (acadQ.isLoading) {
    return (
      <V3Layout v2Href={`/v2/academy-page/${encodeURIComponent(slug || "")}`}>
        <V3Section>
          <div style={{ textAlign: "center", padding: "var(--v3-sp-8) 0", color: "var(--v3-text-muted)" }}>
            Loading academy…
          </div>
        </V3Section>
      </V3Layout>
    );
  }

  if (acadQ.isError || !acadQ.data) {
    return (
      <V3Layout v2Href={`/v2/academy-page/${encodeURIComponent(slug || "")}`}>
        <V3Section>
          <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "var(--v3-sp-8) 0" }}>
            <div style={{ fontSize: 64, marginBottom: "var(--v3-sp-4)", color: "var(--v3-accent)" }}>♟</div>
            <h1 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-2xl)", margin: 0 }}>
              Academy not found
            </h1>
            <p style={{ color: "var(--v3-text-muted)", marginTop: "var(--v3-sp-3)" }}>
              No academy with slug <code style={{ color: "var(--v3-accent)" }}>{slug}</code> — or the
              owner hasn't set up a public page yet.
            </p>
            <div style={{ marginTop: "var(--v3-sp-5)" }}>
              <V3Button as="a" href="/v3/" variant="accent">← Back to ChessGuru</V3Button>
            </div>
          </div>
        </V3Section>
      </V3Layout>
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

  const isOwner = !!authQ.data?.loggedIn && (authQ.data as any).academyId === academy._id;

  return (
    <V3Layout v2Href={`/v2/academy-page/${encodeURIComponent(slug || "")}`}>
      {/* ── Hero cover ────────────────────────────────────── */}
      <section style={{ position: "relative" }}>
        <div style={{
          height: 300,
          background: p.coverUrl
            ? `center/cover no-repeat url(${p.coverUrl})`
            : "linear-gradient(135deg, #35e1fb 0%, #14a2b8 60%, #199ae0 100%)",
        }} />
        <div style={{
          position: "absolute", inset: "auto 0 0 0", height: 120,
          background: "linear-gradient(180deg, transparent, var(--v3-bg))",
        }} />

        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 var(--v3-sp-4)" }}>
          <div style={{
            marginTop: -80,
            display: "flex", gap: "var(--v3-sp-5)", flexWrap: "wrap",
            alignItems: "flex-end",
            paddingBottom: "var(--v3-sp-5)",
          }}>
            {/* Logo circle */}
            <div style={{
              width: 148, height: 148, borderRadius: "var(--v3-r-full)",
              border: "5px solid #fff",
              boxShadow: "var(--v3-shadow-xl)",
              background: p.logoUrl
                ? `center/cover no-repeat url(${p.logoUrl})`
                : "var(--v3-grad-accent)",
              display: "grid", placeItems: "center",
              color: "#fff", fontSize: 56,
              fontFamily: "var(--v3-font-display)", fontWeight: 700,
              flex: "none",
            }}>{!p.logoUrl && displayName.charAt(0).toUpperCase()}</div>

            {/* Name + tagline */}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{
                display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
                color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-sm)",
                marginBottom: 4,
              }}>
                {flag && <span style={{ fontSize: 22 }} title={p.country}>{flag}</span>}
                {p.city && <span>{p.city}</span>}
                {p.foundedYear && <span>· est. {p.foundedYear}</span>}
              </div>
              <h1 style={{
                fontFamily: "var(--v3-font-display)",
                fontSize: "clamp(1.75rem, 4vw, 3rem)",
                fontWeight: 700, margin: 0, lineHeight: 1.1,
              }}>{displayName}</h1>
              {p.tagline && (
                <p style={{
                  color: "var(--v3-text-muted)",
                  fontSize: "var(--v3-fs-lg)",
                  marginTop: "var(--v3-sp-2)",
                  marginBottom: 0,
                }}>{p.tagline}</p>
              )}
              {isOwner && (
                <div style={{ marginTop: "var(--v3-sp-3)" }}>
                  <Link to="/academy-profile/edit" style={{ color: "var(--v3-accent)", fontSize: "var(--v3-fs-sm)", fontWeight: 600 }}>
                    Edit your academy page →
                  </Link>
                </div>
              )}
            </div>

            {/* CTAs */}
            <div style={{ display: "flex", gap: "var(--v3-sp-2)", flexWrap: "wrap" }}>
              <V3Button as="a" href="/v2/signup-academy" variant="accent">Join our academy</V3Button>
              {p.socials.website && (
                <V3Button as="a" href={p.socials.website.startsWith("http") ? p.socials.website : `https://${p.socials.website}`}
                  target="_blank" rel="noreferrer" variant="outlined">Contact</V3Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────────── */}
      {stats.length > 0 && (
        <V3Section paddingY="var(--v3-sp-5)">
          <V3Card padding="var(--v3-sp-5)">
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)`,
              gap: "var(--v3-sp-3)",
            }}>
              {stats.map((s) => (
                <V3StatTile key={s.label} value={s.value} label={s.label} />
              ))}
            </div>
          </V3Card>
        </V3Section>
      )}

      {/* ── Coaches grid (chessiverse `/creators` layout) ── */}
      <V3Section
        eyebrow="Our team"
        title="Meet our coaches"
        subtitle={coaches.length > 0
          ? `Learn from ${coaches.length} handpicked coach${coaches.length === 1 ? "" : "es"}, each with their own style.`
          : "Coaches coming soon."}
      >
        {coaches.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {coaches.map((c) => {
              const cp = c.coachProfile;
              const name = cp.displayName || c.fullName || c.username;
              return (
                <V3CoachCard
                  key={c.userId}
                  username={c.username}
                  displayName={name}
                  titleClass={cp.titleClass}
                  country={cp.country}
                  photoUrl={cp.photoUrl}
                  rating={cp.elo}
                  tags={cp.playingStyles?.slice(0, 3)}
                  role={c.isOwner ? "Founder" : "Coach"}
                />
              );
            })}
          </div>
        )}
      </V3Section>

      {/* ── About + upcoming ──────────────────────────────── */}
      {(p.description || upcomingClasses.length > 0) && (
        <V3Section paddingY="var(--v3-sp-6)">
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: "var(--v3-sp-5)",
          }} className="v3-about-grid">
            {p.description && (
              <V3Card>
                <h2 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-xl)", margin: 0 }}>About</h2>
                <div
                  style={{ color: "var(--v3-text-muted)", marginTop: "var(--v3-sp-3)", lineHeight: 1.6, fontSize: "var(--v3-fs-md)" }}
                  dangerouslySetInnerHTML={renderDescription(p.description)}
                />
              </V3Card>
            )}
            {upcomingClasses.length > 0 && (
              <V3Card>
                <h2 style={{
                  fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-lg)",
                  margin: 0, display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ color: "var(--v3-accent)" }}>📅</span> Upcoming Classes
                </h2>
                <div style={{ display: "grid", gap: "var(--v3-sp-3)", marginTop: "var(--v3-sp-4)" }}>
                  {upcomingClasses.map((cl) => (
                    <div key={cl._id} style={{
                      border: "1px solid var(--v3-border)",
                      borderRadius: "var(--v3-r-lg)",
                      padding: "var(--v3-sp-3)",
                      background: "var(--v3-surface-2)",
                    }}>
                      <div style={{ fontWeight: 600, color: "var(--v3-text)" }}>{cl.title || "Chess class"}</div>
                      <div style={{ color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-xs)", marginTop: 4 }}>
                        {fmtStart(cl.startAt)} · {cl.durationMin} min
                        {cl.coach ? ` · ${cl.coach}` : ""}
                      </div>
                      <Link
                        to={authQ.data?.loggedIn ? `/class-v2/${cl._id}?role=student` : "/login"}
                        style={{ color: "var(--v3-accent)", fontSize: "var(--v3-fs-xs)", fontWeight: 600, marginTop: 8, display: "inline-block" }}
                      >
                        {authQ.data?.loggedIn ? "Join room →" : "Sign in to join →"}
                      </Link>
                    </div>
                  ))}
                </div>
              </V3Card>
            )}
          </div>
        </V3Section>
      )}

      {/* ── Achievements ───────────────────────────────────── */}
      {p.achievements.length > 0 && (
        <V3Section eyebrow="Milestones" title="Achievements">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {p.achievements.map((a) => (
              <V3Card key={a.id}>
                <div style={{ display: "flex", gap: "var(--v3-sp-3)", alignItems: "flex-start" }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: "var(--v3-r-md)",
                    background: "var(--v3-grad-gold)", display: "grid", placeItems: "center",
                    color: "#fff", fontSize: 22, flex: "none",
                  }}>🏆</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "var(--v3-text)" }}>{a.title}</div>
                    {a.year && <div style={{ fontSize: "var(--v3-fs-xs)", color: "var(--v3-text-soft)" }}>{a.year}</div>}
                    {a.description && (
                      <div style={{ fontSize: "var(--v3-fs-sm)", color: "var(--v3-text-muted)", marginTop: 6 }}>{a.description}</div>
                    )}
                  </div>
                </div>
              </V3Card>
            ))}
          </div>
        </V3Section>
      )}

      {/* ── Testimonials ──────────────────────────────────── */}
      {p.testimonials.length > 0 && (
        <V3Section background="tint" eyebrow="Words from students" title="What our academy is like">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {p.testimonials.map((t) => (
              <V3Card key={t.id}>
                <div style={{ color: "var(--v3-accent)", fontSize: 32, lineHeight: 1, marginBottom: 8 }}>&ldquo;</div>
                <p style={{ margin: 0, color: "var(--v3-text)", lineHeight: 1.5 }}>{t.quote}</p>
                <div style={{ marginTop: "var(--v3-sp-4)", display: "flex", alignItems: "center", gap: 10 }}>
                  {t.imageUrl && (
                    <img src={t.imageUrl} alt={t.author}
                      style={{ width: 40, height: 40, borderRadius: "var(--v3-r-full)", objectFit: "cover" }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--v3-text)" }}>{t.author}</div>
                    {t.role && <div style={{ color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-xs)" }}>{t.role}</div>}
                  </div>
                </div>
              </V3Card>
            ))}
          </div>
        </V3Section>
      )}
    </V3Layout>
  );
}
