// V3HomePage — the flagship /v3/ landing.
//
// Mirrors /tmp/civ/01-home.png at a structural level (light bg, generous
// spacing, rounded cards, teal accents). We do NOT copy chessiverse's own
// illustrations — value-prop tiles ship with tasteful inline SVG glyphs
// and a real coach photo when available.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import V3Layout from "../../components/v3/V3Layout";
import V3Hero from "../../components/v3/V3Hero";
import V3Card from "../../components/v3/V3Card";
import V3Section from "../../components/v3/V3Section";
import V3StatTile from "../../components/v3/V3StatTile";
import V3Button from "../../components/v3/V3Button";
import V3CoachCard from "../../components/v3/V3CoachCard";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

// Cheap opportunistic peek at a real coach's public profile so the hero
// portrait / coach-strip below have a real face. Falls back cleanly if the
// call 404s. `gunachess` is our stable in-repo demo coach.
interface CoachPeek {
  username: string;
  fullName: string | null;
  profile: {
    displayName: string; tagline: string; country: string; titleClass: string;
    elo?: number; playingStyles: string[]; photoUrl: string;
  };
  academyName: string | null;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${path}`, { credentials: "include" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const DEMO_COACHES = ["gunachess"];

// Hard-coded plausible platform counts. `/api/academy/list` doesn't exist and
// the spec says hardcode-and-move-on rather than block on new endpoints.
const PLATFORM_STATS = {
  academies: 12,
  coaches: 40,
  students: 350,
  classesTaught: 2_400,
};

function GlyphPlay() {
  return (
    <svg viewBox="0 0 64 64" width="42" height="42" aria-hidden>
      <defs>
        <linearGradient id="v3g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#14a2b8"/><stop offset="1" stopColor="#199ae0"/>
        </linearGradient>
      </defs>
      <rect x="6" y="10" width="52" height="44" rx="10" fill="url(#v3g1)"/>
      <path d="M26 22 L44 32 L26 42 Z" fill="#fff"/>
    </svg>
  );
}
function GlyphCoach() {
  return (
    <svg viewBox="0 0 64 64" width="42" height="42" aria-hidden>
      <defs>
        <linearGradient id="v3g2" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f9a80a"/><stop offset="1" stopColor="#ffb82e"/>
        </linearGradient>
      </defs>
      <circle cx="32" cy="22" r="10" fill="url(#v3g2)"/>
      <path d="M14 54c0-10 8-18 18-18s18 8 18 18Z" fill="url(#v3g2)"/>
    </svg>
  );
}
function GlyphTournament() {
  return (
    <svg viewBox="0 0 64 64" width="42" height="42" aria-hidden>
      <defs>
        <linearGradient id="v3g3" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#35e1fb"/><stop offset="1" stopColor="#14a2b8"/>
        </linearGradient>
      </defs>
      <path d="M18 12h28v10c0 8-6 14-14 14s-14-6-14-14V12z" fill="url(#v3g3)"/>
      <rect x="24" y="38" width="16" height="6" rx="2" fill="var(--v3-text)"/>
      <rect x="18" y="46" width="28" height="6" rx="3" fill="var(--v3-text)"/>
    </svg>
  );
}

export default function V3HomePage() {
  // All hooks BEFORE any early return (Rules of Hooks). This one is safe —
  // the query just tries a couple of demo coaches so the hero has a face.
  const coachQ = useQuery<CoachPeek | null>({
    queryKey: ["v3-home-featured-coach"],
    queryFn: async () => {
      for (const u of DEMO_COACHES) {
        const c = await safeGet<CoachPeek>(`/api/coach/${encodeURIComponent(u)}`);
        if (c) return c;
      }
      return null;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const coach = coachQ.data ?? null;
  const coachName = coach?.profile.displayName || coach?.fullName || "Coach Guna";
  const coachTitle = coach?.profile.titleClass ? `${coach.profile.titleClass} · ${coach.profile.tagline || "Chess coach"}` : "Chess coach";

  return (
    <V3Layout v2Href="/v2/">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <V3Hero
        eyebrow="ChessGuru for academies"
        title={<>Play, learn, and grow chess. <span style={{ color: "var(--v3-accent)" }}>Together.</span></>}
        subtitle="Your coach. Your students. One home. ChessGuru gives chess academies a professional home online — with classes, live boards, replays, and a public academy page that reads like the world's best chess schools."
        ctaLabel="Get started free"
        ctaHref="/v2/signup-academy"
        secondaryCtaLabel="See academies"
        secondaryCtaHref="/v3/academy/guna-chess-academy"
        imageSlot={
          <V3Card padding="0" style={{ maxWidth: 360, width: "100%", overflow: "hidden" }}>
            <div style={{
              height: 260,
              background: coach?.profile.photoUrl
                ? `center/cover no-repeat url(${coach.profile.photoUrl})`
                : "var(--v3-grad-band)",
              position: "relative",
            }}>
              {!coach?.profile.photoUrl && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 88, color: "var(--v3-accent)", opacity: 0.5 }}>♞</div>
              )}
            </div>
            <div style={{ padding: "var(--v3-sp-5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {coach?.profile.titleClass && (
                  <span style={{
                    background: "var(--v3-accent)", color: "#fff",
                    padding: "2px 8px", borderRadius: "var(--v3-r-sm)",
                    fontSize: "var(--v3-fs-xs)", fontWeight: 700,
                  }}>{coach.profile.titleClass}</span>
                )}
                <span style={{ fontFamily: "var(--v3-font-display)", fontWeight: 700, fontSize: "var(--v3-fs-xl)" }}>{coachName}</span>
              </div>
              <div style={{ color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-sm)" }}>{coachTitle}</div>
              {coach && (
                <div style={{ marginTop: "var(--v3-sp-4)" }}>
                  <V3Button as="a" href={`/v3/coach/${coach.username}`} variant="outlined" size="sm">
                    View profile
                  </V3Button>
                </div>
              )}
            </div>
          </V3Card>
        }
      />

      {/* ── Featured academies strip ─────────────────────────── */}
      <V3Section
        eyebrow="Featured by leading chess academies"
        title={<>Where <span style={{ color: "var(--v3-accent)" }}>coaches</span> and <span style={{ color: "var(--v3-accent)" }}>students</span> live online</>}
        subtitle="From weekend hobbyists to titled trainers, ChessGuru is the online home for chess academies of every size."
        paddingY="var(--v3-sp-7)"
      >
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "var(--v3-sp-4)",
          maxWidth: 960,
          margin: "0 auto",
        }}>
          {["Guna Chess Academy", "ChessGuru Junior", "Coastal Chess Club", "Mind Gambit", "Endgame Studio", "The Knight's Room"].map((name) => (
            <div key={name} style={{
              background: "var(--v3-surface)",
              border: "1px solid var(--v3-border)",
              borderRadius: "var(--v3-r-xl)",
              padding: "var(--v3-sp-4)",
              textAlign: "center",
              boxShadow: "var(--v3-shadow-sm)",
              color: "var(--v3-text-muted)",
              fontWeight: 600,
              fontSize: "var(--v3-fs-sm)",
              display: "grid", placeItems: "center", minHeight: 72,
            }}>{name}</div>
          ))}
        </div>
      </V3Section>

      {/* ── Value-prop tiles ─────────────────────────────────── */}
      <V3Section
        eyebrow="What you can do"
        title="A complete home for chess coaching"
        subtitle="Every tool a coach or academy owner reaches for — under one roof."
        background="tint"
      >
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "var(--v3-sp-5)",
        }}>
          {[
            { g: <GlyphPlay/>, t: "Play against 1000+ human-like bots", d: "Our engine roster covers openings, endgames, and every persona in between so students always have a rated challenge." },
            { g: <GlyphCoach/>, t: "Learn from world-class coaches", d: "Discover coaches by title, style, and country. Book classes, join live boards, and rewatch every session on demand." },
            { g: <GlyphTournament/>, t: "Compete in academy tournaments", d: "Custom internal ratings, weekly ladders, and printable trophies keep your academy engaged week after week." },
          ].map((v) => (
            <V3Card key={v.t} interactive>
              <div>{v.g}</div>
              <div style={{
                fontFamily: "var(--v3-font-display)",
                fontWeight: 700,
                fontSize: "var(--v3-fs-xl)",
                marginTop: "var(--v3-sp-3)",
                lineHeight: 1.2,
              }}>{v.t}</div>
              <p style={{ marginTop: "var(--v3-sp-3)", color: "var(--v3-text-muted)", lineHeight: 1.5 }}>{v.d}</p>
            </V3Card>
          ))}
        </div>
      </V3Section>

      {/* ── Featured coach card (if we peeked one) ─────────── */}
      {coach && (
        <V3Section
          eyebrow="Meet a coach"
          title="Real coaches. Real progress."
          subtitle="Every ChessGuru academy is powered by a passionate coach. Here's one to meet."
        >
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 340px))",
            gap: "var(--v3-sp-5)",
            justifyContent: "center",
          }}>
            <V3CoachCard
              username={coach.username}
              displayName={coach.profile.displayName || coach.fullName || coach.username}
              titleClass={coach.profile.titleClass}
              country={coach.profile.country}
              photoUrl={coach.profile.photoUrl}
              rating={coach.profile.elo}
              tags={coach.profile.playingStyles?.slice(0, 3)}
              role={coach.academyName || "Coach"}
            />
          </div>
        </V3Section>
      )}

      {/* ── Stats bar ─────────────────────────────────────── */}
      <V3Section background="surface" paddingY="var(--v3-sp-6)">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "var(--v3-sp-4)",
          alignItems: "center",
        }}>
          <V3StatTile value={PLATFORM_STATS.academies} label="Academies" />
          <V3StatTile value={PLATFORM_STATS.coaches} label="Coaches" />
          <V3StatTile value={PLATFORM_STATS.students} label="Students" />
          <V3StatTile value={`${(PLATFORM_STATS.classesTaught / 1000).toFixed(1)}k`} label="Classes taught" />
        </div>
      </V3Section>

      {/* ── CTA footer band ───────────────────────────────── */}
      <V3Section paddingY="var(--v3-sp-8)">
        <div style={{
          background: "var(--v3-grad-accent)",
          borderRadius: "var(--v3-r-2xl)",
          padding: "var(--v3-sp-8) var(--v3-sp-6)",
          textAlign: "center",
          color: "#fff",
          boxShadow: "var(--v3-shadow-xl)",
        }}>
          <h2 style={{
            fontFamily: "var(--v3-font-display)",
            fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)",
            fontWeight: 700, margin: 0, color: "#fff",
          }}>Ready to grow your chess academy?</h2>
          <p style={{ maxWidth: 640, margin: "var(--v3-sp-4) auto 0", opacity: 0.95, fontSize: "var(--v3-fs-lg)" }}>
            Start free. Add coaches. Invite students. ChessGuru handles the rest —
            live classes, replays, homework, and a beautiful public page for your academy.
          </p>
          <div style={{ marginTop: "var(--v3-sp-6)", display: "flex", justifyContent: "center", gap: "var(--v3-sp-3)", flexWrap: "wrap" }}>
            <a href="/v2/signup-academy" style={{
              background: "#fff", color: "var(--v3-accent-hover)",
              padding: "16px 32px", borderRadius: "var(--v3-r-pill)",
              fontWeight: 700, textDecoration: "none",
              boxShadow: "var(--v3-shadow-lg)",
            }}>Start free →</a>
            <Link to="/v3/academy/guna-chess-academy" style={{
              padding: "16px 32px", borderRadius: "var(--v3-r-pill)",
              fontWeight: 700, textDecoration: "none",
              color: "#fff", border: "2px solid rgba(255,255,255,0.6)",
            }}>See a live academy</Link>
          </div>
        </div>
      </V3Section>
    </V3Layout>
  );
}
