// V3Section — a padded, max-width container with optional eyebrow /
// heading / subheading. Everything about vertical rhythm in v3 pages
// funnels through this component so per-page spacing stays consistent.

import React from "react";

export interface V3SectionProps {
  eyebrow?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "center" | "left";
  background?: "default" | "tint" | "surface";
  children?: React.ReactNode;
  maxWidth?: number;
  paddingY?: string;   // CSS length; default var(--v3-sp-8)
}

export function V3Section({
  eyebrow,
  title,
  subtitle,
  align = "center",
  background = "default",
  children,
  maxWidth = 1160,
  paddingY = "var(--v3-sp-8)",
}: V3SectionProps) {
  const bg =
    background === "tint" ? "var(--v3-grad-band)" :
    background === "surface" ? "var(--v3-surface)" :
    "transparent";
  return (
    <section style={{ background: bg, padding: `${paddingY} var(--v3-sp-4)` }}>
      <div style={{ maxWidth, margin: "0 auto" }}>
        {(eyebrow || title || subtitle) && (
          <header style={{ textAlign: align, marginBottom: "var(--v3-sp-6)" }}>
            {eyebrow && (
              <div style={{
                textTransform: "uppercase", letterSpacing: "0.14em",
                color: "var(--v3-accent)", fontWeight: 600,
                fontSize: "var(--v3-fs-xs)", marginBottom: "var(--v3-sp-3)",
              }}>{eyebrow}</div>
            )}
            {title && (
              <h2 style={{
                fontFamily: "var(--v3-font-display)",
                fontSize: "clamp(1.75rem, 3.2vw, 2.5rem)",
                fontWeight: 700, lineHeight: 1.15, margin: 0,
              }}>{title}</h2>
            )}
            {subtitle && (
              <p style={{
                color: "var(--v3-text-muted)",
                fontSize: "var(--v3-fs-lg)",
                marginTop: "var(--v3-sp-3)", maxWidth: 760,
                marginInline: align === "center" ? "auto" : undefined,
              }}>{subtitle}</p>
            )}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

export default V3Section;
