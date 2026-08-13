// V3Card — canonical white card. Rounded 20px, subtle slate-tinted shadow,
// hover lift when `interactive`. Accepts any child content.

import React, { useState } from "react";

export interface V3CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  padding?: string;   // CSS length; defaults to var(--v3-sp-5) = 24px
  children: React.ReactNode;
}

export function V3Card({ interactive, padding = "var(--v3-sp-5)", style, children, ...rest }: V3CardProps) {
  const [hover, setHover] = useState(false);
  const merged: React.CSSProperties = {
    background: "var(--v3-surface)",
    borderRadius: "var(--v3-r-2xl)",
    boxShadow: interactive && hover ? "var(--v3-shadow-card-hover)" : "var(--v3-shadow-card)",
    border: "1px solid var(--v3-border)",
    padding,
    transition: "box-shadow var(--v3-tx), transform var(--v3-tx-fast)",
    transform: interactive && hover ? "translateY(-2px)" : "",
    ...style,
  };
  return (
    <div
      style={merged}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      {...rest}
    >
      {children}
    </div>
  );
}

export default V3Card;
