// V3CoachCard — chessiverse `/creators` grid card. Photo circle + name +
// title-tag + country flag + rating pill + short tag row + "View profile →".
//
// Deliberately reuses --v3-* tokens for every colour so a future theme
// swap only touches theme/v3-tokens.css.

import React from "react";
import { Link } from "react-router-dom";
import { V3Card } from "./V3Card";

export interface V3CoachCardProps {
  username: string;
  displayName: string;
  titleClass?: string;        // GM, IM, FM etc.
  country?: string;           // ISO-3166 alpha-2
  photoUrl?: string;
  rating?: number;            // e.g. 2450
  tags?: string[];            // playing styles or focus
  role?: string;              // "Coach" | "Academy owner" — small label
  hrefBase?: string;          // default "/v3/coach/"
}

function flagEmoji(cc?: string): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...cc.split("").map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}

export function V3CoachCard({
  username, displayName, titleClass, country, photoUrl, rating, tags, role, hrefBase = "/v3/coach/",
}: V3CoachCardProps) {
  const flag = flagEmoji(country);
  const to = `${hrefBase}${encodeURIComponent(username)}`;
  return (
    <V3Card interactive padding="var(--v3-sp-5)">
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--v3-sp-4)" }}>
        {/* Avatar */}
        <div style={{
          width: 72, height: 72, borderRadius: "var(--v3-r-full)",
          background: "var(--v3-accent-tint)",
          border: "3px solid #fff",
          boxShadow: "var(--v3-shadow-md)",
          overflow: "hidden", flex: "none",
          display: "grid", placeItems: "center",
          color: "var(--v3-accent)", fontFamily: "var(--v3-font-display)",
          fontWeight: 700, fontSize: 22,
        }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={displayName}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : initials(displayName)}
        </div>

        {/* Identity */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            {titleClass && (
              <span style={{
                background: "var(--v3-accent)",
                color: "#fff", padding: "2px 8px",
                borderRadius: "var(--v3-r-sm)",
                fontSize: "var(--v3-fs-xs)", fontWeight: 700,
                letterSpacing: "0.03em",
              }}>{titleClass}</span>
            )}
            <span style={{
              fontFamily: "var(--v3-font-display)",
              fontWeight: 700, fontSize: "var(--v3-fs-lg)",
              color: "var(--v3-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{displayName}</span>
          </div>
          <div style={{
            marginTop: 4,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            color: "var(--v3-text-muted)", fontSize: "var(--v3-fs-sm)",
          }}>
            {role && <span>{role}</span>}
            {flag && <span>{flag}</span>}
            {rating != null && rating > 0 && (
              <span style={{
                background: "var(--v3-accent-tint)",
                color: "var(--v3-accent-hover)", padding: "2px 8px",
                borderRadius: "var(--v3-r-pill)", fontWeight: 700,
                fontSize: "var(--v3-fs-xs)",
              }}>★ {rating}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6,
          marginTop: "var(--v3-sp-4)",
        }}>
          {tags.slice(0, 4).map((t) => (
            <span key={t} style={{
              background: "var(--v3-surface-2)",
              border: "1px solid var(--v3-border)",
              color: "var(--v3-text-muted)",
              padding: "4px 10px",
              borderRadius: "var(--v3-r-pill)",
              fontSize: "var(--v3-fs-xs)",
            }}>{t}</span>
          ))}
        </div>
      )}

      {/* View profile CTA */}
      <div style={{ marginTop: "var(--v3-sp-4)", borderTop: "1px solid var(--v3-border)", paddingTop: "var(--v3-sp-3)" }}>
        <Link to={to} style={{
          color: "var(--v3-accent)",
          fontWeight: 600, textDecoration: "none",
          fontSize: "var(--v3-fs-sm)",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          View profile <span aria-hidden>→</span>
        </Link>
      </div>
    </V3Card>
  );
}

export default V3CoachCard;
