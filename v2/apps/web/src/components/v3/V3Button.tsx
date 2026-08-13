// V3Button — the single button primitive across v3 pages.
// Variants: accent (filled teal), outlined (teal outline + teal text),
// ghost (transparent + text). Sizes sm/md/lg. Anchors get the same
// styling via `as="a"` — the coach-page hero CTAs need a link, not a
// button, so we render the right element instead of nesting <a><button>.

import React from "react";

type Variant = "accent" | "outlined" | "ghost";
type Size = "sm" | "md" | "lg";

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  fontFamily: "var(--v3-font-body)",
  fontWeight: 600,
  borderRadius: "var(--v3-r-pill)",
  transition: "transform var(--v3-tx-fast), box-shadow var(--v3-tx), background var(--v3-tx), color var(--v3-tx)",
  cursor: "pointer",
  border: "1px solid transparent",
  lineHeight: 1,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function styleForVariant(v: Variant): React.CSSProperties {
  switch (v) {
    case "accent":
      return {
        background: "var(--v3-accent)",
        color: "#fff",
        boxShadow: "var(--v3-shadow-md)",
      };
    case "outlined":
      return {
        background: "transparent",
        color: "var(--v3-accent)",
        borderColor: "var(--v3-accent)",
      };
    case "ghost":
      return {
        background: "transparent",
        color: "var(--v3-text)",
      };
  }
}

function styleForSize(s: Size): React.CSSProperties {
  switch (s) {
    case "sm": return { padding: "8px 16px", fontSize: "var(--v3-fs-sm)" };
    case "md": return { padding: "12px 22px", fontSize: "var(--v3-fs-md)" };
    case "lg": return { padding: "16px 32px", fontSize: "var(--v3-fs-lg)" };
  }
}

type Common = {
  variant?: Variant;
  size?: Size;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

type AsButton = Common & React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button" };
type AsAnchor = Common & React.AnchorHTMLAttributes<HTMLAnchorElement> & { as: "a"; href: string };

export type V3ButtonProps = AsButton | AsAnchor;

export function V3Button(props: V3ButtonProps) {
  const { variant = "accent", size = "md", children, className, style: styleProp, ...rest } = props as any;
  const style: React.CSSProperties = { ...baseStyle, ...styleForVariant(variant), ...styleForSize(size), ...(styleProp || {}) };
  const onHover: React.MouseEventHandler<any> = (e) => {
    (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
    if (variant === "accent") (e.currentTarget as HTMLElement).style.boxShadow = "var(--v3-shadow-lg)";
    if (variant === "outlined") { (e.currentTarget as HTMLElement).style.background = "var(--v3-accent-tint)"; }
    if (variant === "ghost") { (e.currentTarget as HTMLElement).style.background = "var(--v3-surface-2)"; }
  };
  const onLeave: React.MouseEventHandler<any> = (e) => {
    (e.currentTarget as HTMLElement).style.transform = "";
    if (variant === "accent") (e.currentTarget as HTMLElement).style.boxShadow = "var(--v3-shadow-md)";
    if (variant === "outlined") { (e.currentTarget as HTMLElement).style.background = "transparent"; }
    if (variant === "ghost") { (e.currentTarget as HTMLElement).style.background = "transparent"; }
  };
  if ((props as AsAnchor).as === "a") {
    const { as: _as, href, ...anchorRest } = rest;
    return (
      <a href={href} className={className} style={style} onMouseEnter={onHover} onMouseLeave={onLeave} {...anchorRest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} style={style} onMouseEnter={onHover} onMouseLeave={onLeave} {...rest}>
      {children}
    </button>
  );
}

export default V3Button;
