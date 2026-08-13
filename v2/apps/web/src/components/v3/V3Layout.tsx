// V3Layout — v3 shell (light navbar + footer + preview banner). Every v3
// page wraps its content in <V3Layout>. NOT used by v2 pages.
//
// The root <div> owns the `.v3` class — that's where all --v3-* tokens
// resolve (see theme/v3-tokens.css). Anything outside .v3 stays on the
// original v2/dark palette.

import React from "react";
import { Link } from "react-router-dom";
import { V3Button } from "./V3Button";

const NAV_LINKS: Array<{ label: string; to: string }> = [
  { label: "Home",      to: "/v3/" },
  { label: "Coaches",   to: "/v3/academy/guna-chess-academy" },
  { label: "Academies", to: "/v3/academy/guna-chess-academy" },
];

export interface V3LayoutProps {
  children: React.ReactNode;
  /** URL to the equivalent v2 page for the "switch to v2" chip.
   *  If omitted, the chip is hidden. */
  v2Href?: string;
}

export function V3Layout({ children, v2Href }: V3LayoutProps) {
  return (
    <div className="v3" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Preview banner — small floating chip top-right on every v3 page. */}
      {v2Href && (
        <a
          href={v2Href}
          style={{
            position: "fixed", top: 12, right: 12, zIndex: 60,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid var(--v3-border)",
            borderRadius: "var(--v3-r-pill)",
            padding: "6px 14px",
            fontSize: "var(--v3-fs-xs)",
            color: "var(--v3-text-muted)",
            boxShadow: "var(--v3-shadow-sm)",
            textDecoration: "none",
            backdropFilter: "blur(6px)",
          }}
        >
          <span style={{ color: "var(--v3-accent)", fontWeight: 700 }}>v3 preview</span>
          &nbsp;·&nbsp;switch to v2
        </a>
      )}

      {/* Navbar */}
      <header style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--v3-border)",
        position: "sticky", top: 0, zIndex: 40,
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          padding: "14px var(--v3-sp-4)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--v3-sp-4)",
        }}>
          {/* Logo left */}
          <Link to="/v3/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 34, height: 34,
              borderRadius: "var(--v3-r-md)",
              background: "var(--v3-grad-accent)",
              display: "grid", placeItems: "center",
              boxShadow: "var(--v3-shadow-md)",
              fontSize: 20,
            }}>♞</div>
            <span style={{
              fontFamily: "var(--v3-font-display)",
              fontWeight: 700, fontSize: "1.2rem",
              color: "var(--v3-text)", letterSpacing: "-0.01em",
            }}>ChessGuru</span>
          </Link>

          {/* Center links (hidden on narrow) */}
          <nav
            className="v3-nav-links"
            style={{ display: "flex", gap: "var(--v3-sp-5)" }}
          >
            {NAV_LINKS.map((l) => (
              <Link
                key={l.to + l.label}
                to={l.to}
                style={{
                  color: "var(--v3-text-muted)",
                  textDecoration: "none",
                  fontWeight: 500,
                  fontSize: "var(--v3-fs-md)",
                }}
              >{l.label}</Link>
            ))}
          </nav>

          {/* Right auth */}
          <div style={{ display: "flex", gap: "var(--v3-sp-2)", alignItems: "center" }}>
            <V3Button as="a" href="/v2/login" variant="outlined" size="sm">Log In</V3Button>
            <V3Button as="a" href="/v2/signup-academy" variant="accent" size="sm">Sign Up</V3Button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main style={{ flex: 1 }}>{children}</main>

      {/* Footer */}
      <footer style={{
        background: "var(--v3-surface)",
        borderTop: "1px solid var(--v3-border)",
        padding: "var(--v3-sp-7) var(--v3-sp-4)",
        marginTop: "var(--v3-sp-8)",
      }}>
        <div style={{
          maxWidth: 1160, margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "var(--v3-sp-6)",
          color: "var(--v3-text-muted)",
          fontSize: "var(--v3-fs-sm)",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: "var(--v3-r-md)", background: "var(--v3-grad-accent)", display: "grid", placeItems: "center", fontSize: 16 }}>♞</div>
              <span style={{ fontFamily: "var(--v3-font-display)", color: "var(--v3-text)", fontWeight: 700 }}>ChessGuru</span>
            </div>
            <div>Play, learn, and grow chess.</div>
          </div>
          <div>
            <div style={{ color: "var(--v3-text)", fontWeight: 600, marginBottom: 10 }}>Product</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              <li><a href="/v2/">Puzzles</a></li>
              <li><a href="/v2/play">Play</a></li>
              <li><a href="/v2/study">Study</a></li>
            </ul>
          </div>
          <div>
            <div style={{ color: "var(--v3-text)", fontWeight: 600, marginBottom: 10 }}>For Coaches</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              <li><a href="/v2/signup-academy">Start an academy</a></li>
              <li><a href="/v2/coach-profile/edit">Your public page</a></li>
            </ul>
          </div>
          <div>
            <div style={{ color: "var(--v3-text)", fontWeight: 600, marginBottom: 10 }}>Company</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              <li><a href="/v2/">About</a></li>
              <li><a href="/v2/">Contact</a></li>
            </ul>
          </div>
        </div>
        <div style={{
          maxWidth: 1160, margin: "var(--v3-sp-6) auto 0",
          paddingTop: "var(--v3-sp-4)",
          borderTop: "1px solid var(--v3-border)",
          textAlign: "center",
          fontSize: "var(--v3-fs-xs)",
          color: "var(--v3-text-soft)",
        }}>
          Powered by ChessGuru · © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}

export default V3Layout;
