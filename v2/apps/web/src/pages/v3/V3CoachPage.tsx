// V3CoachPage — chessiverse-styled coach profile at /v3/coach/:username
//
// Reads the SAME /api/coach/:username endpoint that v2's CoachPublic hits;
// renders everything in the new light palette. No new API calls.
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
  userId: string; username: string;
  role: "coach" | "academy_owner"; academyId: string | null;
  academyName: string | null; fullName: string | null;
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

function flagEmoji(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

function renderBio(text: string): { __html: string } {
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

export default function V3CoachPage() {
  const { username } = useParams<{ username: string }>();

  // All hooks BEFORE any early return.
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; userId?: string; username?: string }>("/auth/me").catch(() => ({ loggedIn: false })),
    retry: false,
  });
  const coachQ = useQuery({
    queryKey: ["coach-public-v3", username],
    queryFn: () => get<CoachResp>(`/api/coach/${encodeURIComponent(username || "")}`),
    enabled: !!username,
    retry: false,
  });
  const scheduleQ = useQuery({
    queryKey: ["coach-schedule-v3", coachQ.data?.userId, coachQ.data?.academyId],
    queryFn: () => get<ScheduleResp>("/api/class/schedule").catch(() => ({ live: [], upcoming: [] })),
    enabled: !!coachQ.data?.userId,
    retry: false,
  });

  const coachUserId = coachQ.data?.userId;
  const coachUsername = coachQ.data?.username;
  const upcoming = useMemo(() => {
    const rows = [ ...(scheduleQ.data?.live || []), ...(scheduleQ.data?.upcoming || []) ];
    if (!coachUserId) return [];
    return rows
      .filter((r) => r.coachUserId === coachUserId || r.coach === coachUsername)
      .slice(0, 3);
  }, [scheduleQ.data, coachUserId, coachUsername]);

  if (coachQ.isLoading) {
    return (
      <V3Layout v2Href={`/v2/coach/${encodeURIComponent(username || "")}`}>
        <V3Section>
          <div style={{ textAlign: "center", padding: "var(--v3-sp-8) 0", color: "var(--v3-text-muted)" }}>
            Loading coach profile…
          </div>
        </V3Section>
      </V3Layout>
    );
  }

  if (coachQ.isError || !coachQ.data) {
    return (
      <V3Layout v2Href={`/v2/coach/${encodeURIComponent(username || "")}`}>
        <V3Section>
          <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "var(--v3-sp-8) 0" }}>
            <div style={{ fontSize: 64, marginBottom: "var(--v3-sp-4)", color: "var(--v3-accent)" }}>♟</div>
            <h1 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-2xl)", margin: 0 }}>
              Coach not found
            </h1>
            <p style={{ color: "var(--v3-text-muted)", marginTop: "var(--v3-sp-3)" }}>
              No coach with that username — or they haven't set up a public page yet.
            </p>
            <div style={{ marginTop: "var(--v3-sp-5)" }}>
              <V3Button as="a" href="/v3/" variant="accent">← Back to ChessGuru</V3Button>
            </div>
          </div>
        </V3Section>
      </V3Layout>
    );
  }

  const c = coachQ.data;
  const p = c.profile;
  const displayName = p.displayName || c.fullName || c.username;
  const flag = flagEmoji(p.country);
  const stats: Array<{ label: string; value: number | string }> = [];
  if (p.yearsTeaching != null && p.yearsTeaching > 0) stats.push({ label: "Years teaching", value: p.yearsTeaching });
  if (p.topStudents.length > 0) stats.push({ label: "Students", value: p.topStudents.length });
  if (p.trophies.length > 0) stats.push({ label: "Trophies", value: p.trophies.length });
  if (p.elo) stats.push({ label: "Peak Elo", value: p.elo });

  const socialEntries: Array<[string, string]> = ([
    ["website", p.socials.website],
    ["twitter", p.socials.twitter],
    ["youtube", p.socials.youtube],
    ["instagram", p.socials.instagram],
    ["lichess", p.socials.lichess],
    ["chesscom", p.socials.chesscom],
  ] as Array<[string, string | undefined]>).filter(([, v]) => !!v) as Array<[string, string]>;

  const isMe = !!authQ.data?.loggedIn && (authQ.data as any).username === c.username;

  return (
    <V3Layout v2Href={`/v2/coach/${encodeURIComponent(username || "")}`}>
      {/* ── Hero cover ─────────────────────────────────── */}
      <section style={{ position: "relative" }}>
        <div style={{
          height: 320,
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
            marginTop: -90,
            display: "flex", gap: "var(--v3-sp-5)", flexWrap: "wrap",
            alignItems: "flex-end",
            paddingBottom: "var(--v3-sp-5)",
          }}>
            {/* Circular photo */}
            <div style={{
              width: 176, height: 176, borderRadius: "var(--v3-r-full)",
              border: "5px solid #fff",
              boxShadow: "var(--v3-shadow-xl)",
              background: p.photoUrl
                ? `center/cover no-repeat url(${p.photoUrl})`
                : "var(--v3-grad-accent)",
              display: "grid", placeItems: "center",
              color: "#fff", fontSize: 66,
              fontFamily: "var(--v3-font-display)", fontWeight: 700,
              flex: "none",
            }}>{!p.photoUrl && displayName.charAt(0).toUpperCase()}</div>

            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
                {p.titleClass && (
                  <span style={{
                    background: "var(--v3-accent)", color: "#fff",
                    padding: "3px 10px", borderRadius: "var(--v3-r-sm)",
                    fontSize: "var(--v3-fs-xs)", fontWeight: 700, letterSpacing: "0.04em",
                  }}>{p.titleClass}</span>
                )}
                {flag && <span style={{ fontSize: 22 }} title={p.country}>{flag}</span>}
                {p.city && <span style={{ color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-sm)" }}>{p.city}</span>}
                {c.academyName && (
                  <span style={{ color: "var(--v3-text-soft)", fontSize: "var(--v3-fs-sm)" }}>· {c.academyName}</span>
                )}
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
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "var(--v3-sp-3)", flexWrap: "wrap" }}>
                {p.elo && (
                  <span style={{
                    background: "var(--v3-accent-tint)", color: "var(--v3-accent-hover)",
                    padding: "4px 12px", borderRadius: "var(--v3-r-pill)",
                    fontSize: "var(--v3-fs-sm)", fontWeight: 700,
                  }}>FIDE {p.elo}{p.federation ? ` · ${p.federation}` : ""}</span>
                )}
                {isMe && (
                  <Link to="/coach-profile/edit" style={{ color: "var(--v3-accent)", fontSize: "var(--v3-fs-sm)", fontWeight: 600 }}>
                    Edit your profile →
                  </Link>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "var(--v3-sp-2)", flexWrap: "wrap" }}>
              <V3Button as="a" href="/v2/play" variant="accent" size="lg">
                <span aria-hidden>▶</span> Play free with me
              </V3Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Body: 2-col with sidebar ─────────────────── */}
      <V3Section paddingY="var(--v3-sp-6)">
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "var(--v3-sp-5)",
        }} className="v3-coach-grid">
          <div style={{ display: "grid", gap: "var(--v3-sp-5)" }}>
            {p.bio && (
              <V3Card>
                <h2 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-xl)", margin: 0 }}>About</h2>
                <div
                  style={{ color: "var(--v3-text-muted)", marginTop: "var(--v3-sp-3)", lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={renderBio(p.bio)}
                />
              </V3Card>
            )}
            {p.playingStyles.length > 0 && (
              <V3Card>
                <h2 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-xl)", margin: 0 }}>Playing style</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "var(--v3-sp-3)" }}>
                  {p.playingStyles.map((s) => (
                    <span key={s} style={{
                      background: "var(--v3-accent-tint)",
                      border: "1px solid var(--v3-accent-soft)",
                      color: "var(--v3-accent-hover)",
                      padding: "6px 14px",
                      borderRadius: "var(--v3-r-pill)",
                      fontSize: "var(--v3-fs-sm)", fontWeight: 500,
                    }}>{s}</span>
                  ))}
                </div>
              </V3Card>
            )}
            {socialEntries.length > 0 && (
              <V3Card>
                <h2 style={{ fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-xl)", margin: 0 }}>Find me on</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: "var(--v3-sp-3)" }}>
                  {socialEntries.map(([kind, v]) => (
                    <a
                      key={kind}
                      href={socialHref(kind, v)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: "var(--v3-surface-2)",
                        border: "1px solid var(--v3-border)",
                        color: "var(--v3-text)",
                        padding: "8px 14px",
                        borderRadius: "var(--v3-r-md)",
                        fontSize: "var(--v3-fs-sm)",
                        fontWeight: 500,
                        textDecoration: "none",
                        textTransform: "capitalize",
                      }}
                    >{kind}</a>
                  ))}
                </div>
              </V3Card>
            )}
          </div>

          <div style={{ display: "grid", gap: "var(--v3-sp-5)", alignContent: "start" }}>
            {stats.length > 0 && (
              <V3Card>
                <h2 style={{
                  fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-md)",
                  color: "var(--v3-accent)", textTransform: "uppercase",
                  letterSpacing: "0.1em", margin: 0,
                }}>Stats</h2>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "var(--v3-sp-3)",
                  marginTop: "var(--v3-sp-4)",
                }}>
                  {stats.map((s) => (
                    <V3StatTile key={s.label} value={s.value} label={s.label} />
                  ))}
                </div>
              </V3Card>
            )}
            {upcoming.length > 0 && (
              <V3Card>
                <h2 style={{
                  fontFamily: "var(--v3-font-display)", fontSize: "var(--v3-fs-md)",
                  color: "var(--v3-accent)", textTransform: "uppercase",
                  letterSpacing: "0.1em", margin: 0,
                }}>📅 Upcoming Classes</h2>
                <div style={{ display: "grid", gap: "var(--v3-sp-3)", marginTop: "var(--v3-sp-4)" }}>
                  {upcoming.map((cl) => (
                    <div key={cl._id} style={{
                      border: "1px solid var(--v3-border)",
                      borderRadius: "var(--v3-r-lg)",
                      padding: "var(--v3-sp-3)",
                      background: "var(--v3-surface-2)",
                    }}>
                      <div style={{ fontWeight: 600 }}>{cl.title}</div>
                      <div style={{ color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-xs)", marginTop: 4 }}>
                        {fmtStart(cl.startAt)} · {cl.durationMin} min
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
        </div>
      </V3Section>

      {/* ── Achievements ─────────────────────────────── */}
      {p.achievements.length > 0 && (
        <V3Section eyebrow="Highlights" title="🏆 Achievements">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {p.achievements.map((a) => (
              <V3Card key={a.id} interactive>
                {a.imageUrl && (
                  <img src={a.imageUrl} alt={a.title} style={{
                    width: "100%", height: 140, objectFit: "cover",
                    borderRadius: "var(--v3-r-lg)", marginBottom: "var(--v3-sp-3)",
                  }} />
                )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 700 }}>{a.title}</div>
                  {a.year && (
                    <span style={{
                      background: "var(--v3-grad-gold)", color: "#4a2d00",
                      padding: "2px 8px", borderRadius: "var(--v3-r-sm)",
                      fontSize: "var(--v3-fs-xs)", fontWeight: 700,
                    }}>{a.year}</span>
                  )}
                </div>
                {a.description && (
                  <p style={{ color: "var(--v3-text-muted)", marginTop: 8, fontSize: "var(--v3-fs-sm)" }}>{a.description}</p>
                )}
              </V3Card>
            ))}
          </div>
        </V3Section>
      )}

      {/* ── Top Students ─────────────────────────────── */}
      {p.topStudents.length > 0 && (
        <V3Section eyebrow="Proud coach" title="🎓 Top Students">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {p.topStudents.map((s) => (
              <V3Card key={s.id}>
                <div style={{ display: "flex", gap: "var(--v3-sp-3)", alignItems: "center" }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: "var(--v3-r-full)",
                    background: s.imageUrl ? `center/cover no-repeat url(${s.imageUrl})` : "var(--v3-accent-tint)",
                    display: "grid", placeItems: "center",
                    color: "var(--v3-accent)", fontWeight: 700, flex: "none",
                  }}>{!s.imageUrl && s.name.charAt(0).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    {s.peakRating && (
                      <div style={{ color: "var(--v3-accent-hover)", fontSize: "var(--v3-fs-xs)", fontWeight: 600 }}>
                        Peak {s.peakRating}
                      </div>
                    )}
                  </div>
                </div>
                {s.note && (
                  <p style={{ color: "var(--v3-text-muted)", marginTop: "var(--v3-sp-3)", fontSize: "var(--v3-fs-sm)" }}>
                    {s.note}
                  </p>
                )}
              </V3Card>
            ))}
          </div>
        </V3Section>
      )}

      {/* ── Trophies ─────────────────────────────────── */}
      {p.trophies.length > 0 && (
        <V3Section background="tint" eyebrow="Cabinet" title="🏆 Trophies">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "var(--v3-sp-4)",
          }}>
            {p.trophies.map((t) => (
              <V3Card key={t.id} interactive padding="var(--v3-sp-3)">
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt={t.name} style={{
                    width: "100%", height: 120, objectFit: "cover",
                    borderRadius: "var(--v3-r-md)", marginBottom: 8,
                  }} />
                ) : (
                  <div style={{
                    height: 120, borderRadius: "var(--v3-r-md)",
                    background: "var(--v3-grad-gold)",
                    display: "grid", placeItems: "center",
                    fontSize: 48, marginBottom: 8,
                  }}>🏆</div>
                )}
                <div style={{ fontWeight: 700, fontSize: "var(--v3-fs-sm)" }}>{t.name}</div>
                {t.year && <div style={{ color: "var(--v3-text-soft)", fontSize: "var(--v3-fs-xs)" }}>{t.year}</div>}
              </V3Card>
            ))}
          </div>
        </V3Section>
      )}
    </V3Layout>
  );
}
