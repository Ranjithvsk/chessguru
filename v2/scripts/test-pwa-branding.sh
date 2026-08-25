#!/bin/bash
# Rigorous end-to-end test of PWA tenant-branding fix.
# Owner ask 2026-08-25: gunachess students reported PWA showed ChessGuru name+icon.
# Tests exercise both live HTTPS and local API — asserting the wire-level bytes
# that a mobile browser would use to decide the PWA install name + icon.

set -u
PASS=0
FAIL=0
G="\033[32m"; R="\033[31m"; Y="\033[33m"; NC="\033[0m"

assert() {
  local name="$1"; local cond="$2"; local detail="${3:-}"
  if [ "$cond" = "true" ]; then
    echo -e "${G}✓${NC} $name"
    PASS=$((PASS+1))
  else
    echo -e "${R}✗${NC} $name  ${Y}$detail${NC}"
    FAIL=$((FAIL+1))
  fi
}

echo "==== TENANT (gunachess.com) — must show GUNA everywhere ===="

# --- Manifest ---
M=$(curl -s --resolve gunachess.com:443:127.0.0.1 "https://gunachess.com/manifest.webmanifest")
NAME=$(echo "$M" | jq -r .name)
SHORT=$(echo "$M" | jq -r .short_name)
COLOR=$(echo "$M" | jq -r .theme_color)
ICON0=$(echo "$M" | jq -r .icons[0].src)
ICON1=$(echo "$M" | jq -r .icons[1].src)

assert "gunachess manifest.webmanifest .name = 'Guna Chess Academy'" \
  "$([ "$NAME" = "Guna Chess Academy" ] && echo true || echo false)" "got '$NAME'"
assert "gunachess manifest.webmanifest .short_name = 'Guna Chess'" \
  "$([ "$SHORT" = "Guna Chess" ] && echo true || echo false)" "got '$SHORT'"
assert "gunachess manifest.webmanifest .theme_color = '#14a2b8' (tenant accent, not #7c3aed)" \
  "$([ "$COLOR" = "#14a2b8" ] && echo true || echo false)" "got '$COLOR'"
assert "gunachess manifest icon[0] is /academy/guna-192.webp (NOT /icons/icon-192.png)" \
  "$([ "$ICON0" = "/academy/guna-192.webp" ] && echo true || echo false)" "got '$ICON0'"
assert "gunachess manifest icon[1] is /academy/guna-512.webp" \
  "$([ "$ICON1" = "/academy/guna-512.webp" ] && echo true || echo false)" "got '$ICON1'"
assert "gunachess manifest contains NO 'ChessGuru' literal" \
  "$(echo "$M" | grep -qi 'ChessGuru' && echo false || echo true)" "grep hit in body"

# --- HTML shell: index.html sub_filters ---
H=$(curl -sk --resolve gunachess.com:443:127.0.0.1 "https://gunachess.com/index.html")
assert "index.html <title> = 'Guna Chess Academy'" \
  "$(echo "$H" | grep -q '<title>Guna Chess Academy</title>' && echo true || echo false)" \
  "raw: $(echo "$H" | grep -o '<title>[^<]*</title>')"
assert "index.html apple-mobile-web-app-title = 'Guna Chess Academy'" \
  "$(echo "$H" | grep -q 'id="cg-apple-title" content="Guna Chess Academy"' && echo true || echo false)" \
  "raw: $(echo "$H" | grep -o 'apple-mobile-web-app-title[^>]*')"
assert "index.html apple-touch-icon href = tenant logo" \
  "$(echo "$H" | grep -q 'id="cg-apple-icon" href="/academy/guna-192.webp"' && echo true || echo false)" \
  "raw: $(echo "$H" | grep -o 'apple-touch-icon[^>]*')"
assert "index.html theme-color meta = #14a2b8 (tenant, not #7c3aed)" \
  "$(echo "$H" | grep -q 'id="cg-theme-color" content="#14a2b8"' && echo true || echo false)" \
  "raw: $(echo "$H" | grep -o 'name="theme-color"[^>]*')"
assert "index.html favicon = tenant logo (NOT /favicon.svg)" \
  "$(echo "$H" | grep -q 'id="cg-favicon" href="/academy/guna-logo.webp"' && echo true || echo false)" \
  "raw: $(echo "$H" | grep -o 'id="cg-favicon"[^>]*')"
assert "index.html error fallback text swapped to tenant name" \
  "$(echo "$H" | grep -q 'Guna Chess Academy failed to load twice' && echo true || echo false)" ""
assert "index.html no residual 'ChessGuru — Puzzle Trainer' in <title>" \
  "$(echo "$H" | grep -q '<title>ChessGuru' && echo false || echo true)" "leaked"

echo
echo "==== CANONICAL (chessguru.cc) — must STILL show ChessGuru (regression guard) ===="

MC=$(curl -sk "https://chessguru.cc/manifest.webmanifest")
NC_NAME=$(echo "$MC" | jq -r .name 2>/dev/null)
NC_SHORT=$(echo "$MC" | jq -r .short_name 2>/dev/null)
assert "chessguru.cc manifest .name = 'ChessGuru'" \
  "$([ "$NC_NAME" = "ChessGuru" ] && echo true || echo false)" "got '$NC_NAME'"
assert "chessguru.cc manifest .short_name = 'ChessGuru'" \
  "$([ "$NC_SHORT" = "ChessGuru" ] && echo true || echo false)" "got '$NC_SHORT'"

HC=$(curl -sk "https://chessguru.cc/index.html")
assert "chessguru.cc <title> STILL = 'ChessGuru — Puzzle Trainer'" \
  "$(echo "$HC" | grep -q '<title>ChessGuru — Puzzle Trainer</title>' && echo true || echo false)" ""
assert "chessguru.cc apple-mobile-web-app-title STILL = 'ChessGuru'" \
  "$(echo "$HC" | grep -q 'id="cg-apple-title" content="ChessGuru"' && echo true || echo false)" \
  "raw: $(echo "$HC" | grep -o 'apple-mobile-web-app-title[^>]*')"

echo
echo "==== SIDE-CHECK: dynamic endpoint auto-fallback (tenant without logo) ===="

# Ask API for a hypothetical tenant that doesn't exist (should return ChessGuru fallback)
NX=$(curl -s "http://localhost:4000/api/academy-page/manifest?host=doesnotexist.example.com")
NX_NAME=$(echo "$NX" | jq -r .name)
assert "Unknown host falls back to ChessGuru (not tenant)" \
  "$([ "$NX_NAME" = "ChessGuru" ] && echo true || echo false)" "got '$NX_NAME'"

# Test data-URI monogram fallback by removing logoUrl in a copy
# (Not run here — would need to plant a fake academy. Verified in code review.)
echo -e "${Y}(monogram-fallback path exercised by code review — no active tenant lacks a logo)${NC}"

echo
echo "==== SIDE-CHECK: v2api proxy still works on tenant vhost ===="
V=$(curl -sk --resolve gunachess.com:443:127.0.0.1 "https://gunachess.com/v2api/api/livekit/status")
V_OK=$(echo "$V" | jq -r .configured 2>/dev/null)
assert "gunachess.com /v2api/livekit/status returns json (proxy intact)" \
  "$([ "$V_OK" = "true" ] || [ "$V_OK" = "false" ] && echo true || echo false)" "got '$V'"

echo
if [ $FAIL -eq 0 ]; then
  echo -e "${G}==== $PASS passed, $FAIL failed ====${NC}"
  exit 0
else
  echo -e "${R}==== $PASS passed, $FAIL failed ====${NC}"
  exit 1
fi
