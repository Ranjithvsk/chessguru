// V3StatTile — mini stat: big number + label. Used in stats bars on home,
// academy, coach pages.

import React from "react";

export interface V3StatTileProps {
  value: number | string;
  label: string;
  accent?: boolean;   // paints the number in accent teal
}

export function V3StatTile({ value, label, accent = true }: V3StatTileProps) {
  return (
    <div style={{ textAlign: "center", padding: "var(--v3-sp-4) var(--v3-sp-3)", minWidth: 120 }}>
      <div style={{
        fontFamily: "var(--v3-font-display)",
        fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
        fontWeight: 700,
        color: accent ? "var(--v3-accent)" : "var(--v3-text)",
        lineHeight: 1,
      }}>{value}</div>
      <div style={{
        color: "var(--v3-text-muted)",
        fontSize: "var(--v3-fs-sm)",
        marginTop: "var(--v3-sp-2)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        fontWeight: 500,
      }}>{label}</div>
    </div>
  );
}

export default V3StatTile;
