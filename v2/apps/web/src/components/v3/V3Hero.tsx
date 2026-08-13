// V3Hero — the big page-top hero. Title + subtitle + optional bullets + CTA
// on the left; optional image slot on the right. Renders a soft cyan
// background band via the section wrapper.

import React from "react";
import { V3Button } from "./V3Button";

export interface V3HeroProps {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  bullets?: string[];
  ctaLabel?: string;
  ctaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  /** Right-side image URL (portrait / illustration). Omit → hero is
   *  center-aligned single column. */
  imageUrl?: string;
  /** Optional custom right-side node (e.g. a card cluster). Wins over imageUrl. */
  imageSlot?: React.ReactNode;
}

export function V3Hero({
  eyebrow,
  title,
  subtitle,
  bullets,
  ctaLabel,
  ctaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  imageUrl,
  imageSlot,
}: V3HeroProps) {
  const hasRight = !!imageUrl || !!imageSlot;
  return (
    <section style={{
      background: "var(--v3-bg-band)",
      padding: "var(--v3-sp-8) var(--v3-sp-4)",
      overflow: "hidden",
    }}>
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        display: "grid",
        gridTemplateColumns: hasRight ? "1.15fr 1fr" : "1fr",
        gap: "var(--v3-sp-8)",
        alignItems: "center",
      }}
      className={hasRight ? "v3-hero-2col" : ""}
      >
        {/* Copy */}
        <div style={{ textAlign: hasRight ? "left" : "center", maxWidth: hasRight ? undefined : 820, marginInline: hasRight ? undefined : "auto" }}>
          {eyebrow && (
            <div style={{
              textTransform: "uppercase", letterSpacing: "0.14em",
              color: "var(--v3-accent)", fontWeight: 600,
              fontSize: "var(--v3-fs-xs)", marginBottom: "var(--v3-sp-3)",
            }}>{eyebrow}</div>
          )}
          <h1 style={{
            fontFamily: "var(--v3-font-display)",
            fontSize: "clamp(2.25rem, 5vw, 3.75rem)",
            fontWeight: 700, lineHeight: 1.06,
            margin: 0, letterSpacing: "-0.02em",
            color: "var(--v3-text)",
          }}>{title}</h1>
          {subtitle && (
            <p style={{
              marginTop: "var(--v3-sp-4)",
              fontSize: "var(--v3-fs-lg)",
              color: "var(--v3-text-muted)",
              maxWidth: 640,
              marginInline: hasRight ? 0 : "auto",
              lineHeight: 1.5,
            }}>{subtitle}</p>
          )}
          {bullets && bullets.length > 0 && (
            <ul style={{
              listStyle: "none", padding: 0,
              marginTop: "var(--v3-sp-5)",
              display: "grid", gap: "var(--v3-sp-3)",
              maxWidth: 520, marginInline: hasRight ? 0 : "auto",
            }}>
              {bullets.map((b) => (
                <li key={b} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  color: "var(--v3-text)", fontSize: "var(--v3-fs-md)",
                }}>
                  <span aria-hidden style={{
                    width: 22, height: 22, borderRadius: "var(--v3-r-full)",
                    background: "var(--v3-accent-tint)", color: "var(--v3-accent)",
                    display: "grid", placeItems: "center", flex: "none",
                    fontSize: 14, fontWeight: 700,
                  }}>✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {(ctaLabel || secondaryCtaLabel) && (
            <div style={{
              display: "flex", gap: "var(--v3-sp-3)",
              justifyContent: hasRight ? "flex-start" : "center",
              marginTop: "var(--v3-sp-6)", flexWrap: "wrap",
            }}>
              {ctaLabel && ctaHref && (
                <V3Button as="a" href={ctaHref} variant="accent" size="lg">
                  {ctaLabel} <span aria-hidden style={{ fontSize: "1.1em" }}>→</span>
                </V3Button>
              )}
              {secondaryCtaLabel && secondaryCtaHref && (
                <V3Button as="a" href={secondaryCtaHref} variant="outlined" size="lg">
                  {secondaryCtaLabel}
                </V3Button>
              )}
            </div>
          )}
        </div>

        {/* Right slot */}
        {hasRight && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            {imageSlot ? imageSlot : (
              <div style={{
                width: "100%", maxWidth: 420, aspectRatio: "4 / 5",
                borderRadius: "var(--v3-r-2xl)",
                background: "var(--v3-surface)",
                boxShadow: "var(--v3-shadow-xl)",
                overflow: "hidden",
                border: "1px solid var(--v3-border)",
              }}>
                <img
                  src={imageUrl!}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default V3Hero;
