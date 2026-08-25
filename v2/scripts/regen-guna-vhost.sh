#!/bin/bash
# One-shot regen of gunachess.com nginx vhost with the new PWA-tenant manifest
# proxy + additional sub_filter rules. Matches the template baked into
# apps/api/src/academy-profile/academy-domain.service.ts::buildNginxConf.

set -e

DOMAIN="gunachess.com"
SLUG="guna-chess-academy"
NAME="Guna Chess Academy"
SHORT_NAME="Guna Chess"
LOGO="/academy/guna-logo.webp"
ICON192="/academy/guna-192.webp"

CONF="/etc/nginx/coach-domains/${DOMAIN}.conf"
NEW_CONF=$(mktemp)

cat > "$NEW_CONF" <<EOF
# Auto-generated $(date -u +%Y-%m-%dT%H:%M:%S.000Z) by regen-guna-vhost.sh (owner ask 2026-08-25: PWA tenant branding).
# Academy custom-domain SSL vhost for ${DOMAIN}. Delete via /api/me/academy-profile/domain/remove.
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};
  location /.well-known/acme-challenge/ { alias /var/www/acme/; }
  location / { return 301 https://\$host\$request_uri; }
}
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name ${DOMAIN};
  http2 on;

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;

  root /var/www/chessguru;
  index index.html;
  # Server-side tenant landing (no client-side flash): / goes straight to the
  # academy public page for this tenant.
  location = / { return 302 /academy-page/${SLUG}; }
  # /v2/ prefix retired 2026-08-15 — legacy URLs 301 to root.
  location = /v2 { return 301 /; }
  location /v2/ { rewrite ^/v2/(.*)\$ /\$1 permanent; }
  # PWA manifest — proxied to the dynamic per-host endpoint so Android's
  # "Add to Home Screen" flow gets the TENANT name + logo + theme color
  # instead of the static ChessGuru manifest. Owner ask 2026-08-25:
  # deepakcharan + gunachess students reported their installed PWA
  # showed "ChessGuru" branding on Android launchers.
  location = /manifest.webmanifest {
    proxy_pass http://localhost:4000/api/academy-page/manifest?host=\$host;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    add_header Cache-Control "public, max-age=300" always;
  }
  # sub_filter templates the tenant name into the SERVED index.html so the
  # browser tab never shows "ChessGuru" before JS runs. Applies only to
  # text/html; asset responses are untouched.
  location / {
    try_files \$uri /index.html;
    add_header Cache-Control "no-cache" always;
    sub_filter_once off;
    sub_filter "<title>ChessGuru — Puzzle Trainer</title>" "<title>${NAME}</title>";
    sub_filter "id=\"cg-theme-color\" content=\"#7c3aed\"" "id=\"cg-theme-color\" content=\"#14a2b8\"";
    sub_filter "id=\"cg-apple-title\" content=\"ChessGuru\"" "id=\"cg-apple-title\" content=\"${NAME}\"";
    sub_filter "ChessGuru failed to load twice." "${NAME} failed to load twice.";
    sub_filter "id=\"cg-favicon\" type=\"image/svg+xml\" href=\"/favicon.svg\"" "id=\"cg-favicon\" href=\"${LOGO}\"";
    sub_filter "id=\"cg-apple-icon\" href=\"/icons/icon-192.png\"" "id=\"cg-apple-icon\" href=\"${ICON192}\"";
  }
  location /assets/ { try_files \$uri =404; }

  location /coach-img/ {
    alias /home/ubuntu/chessguru-coach-images/;
    add_header Cache-Control "public, max-age=86400";
    access_log off;
  }
  location /book-files/ {
    alias /home/ubuntu/chessguru-book-files/;
    add_header Cache-Control "public, max-age=86400";
    access_log off;
  }

  location /academy-img/ {
    alias /home/ubuntu/chessguru-academy-images/;
    add_header Cache-Control "public, max-age=86400";
    access_log off;
  }

  location /v2api/ {
    proxy_pass http://localhost:4000/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Custom-Domain \$host;
    proxy_read_timeout 3600;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "Upgrade";
  }
}
EOF

echo "Diff against current:"
sudo diff "$CONF" "$NEW_CONF" || true
echo
sudo cp "$CONF" "${CONF}.bak-$(date +%s)"
sudo cp "$NEW_CONF" "$CONF"
rm "$NEW_CONF"
sudo nginx -t
sudo systemctl reload nginx
echo "Reloaded nginx with new gunachess.com vhost."
