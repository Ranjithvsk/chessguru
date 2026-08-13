// Coach custom-domain automation (Phase 2, 2026-08-13).
//
// Flow:
//   1. Coach POSTs /api/me/coach-profile/domain/set { domain }
//      → validated, stored, status = "pending_dns".
//   2. Coach sets a CNAME (@ -> coach.dreamcy.com) or A record at their
//      registrar and POSTs /api/me/coach-profile/domain/verify.
//   3. We resolve the domain from Node's DNS. Pass → status = "provisioning"
//      and we kick off certbot + nginx wiring in the background (setImmediate).
//   4. Background worker:
//        - runs `certbot certonly --webroot -w /var/www/acme -d <domain>`
//        - writes /etc/nginx/coach-domains/<domain>.conf (SPA + /v2api/ proxy)
//        - nginx -t; systemctl reload nginx
//        - status flips to "active" (+ activatedAt) or "failed" (+ errorMsg)
//   5. GET /status polls what we know; POST /remove tears the block + cert down.
//
// Security: user input flows into a shell command (certbot -d <domain>). We
// enforce a strict regex BEFORE the value reaches spawn(), never string-interp
// it into a shell — spawn() with an argument array can't break out of quoting
// even if regex missed something. Sudoers pins the exact commands ubuntu can run
// as root; no wildcarded `certbot *`.
//
// Rate-limit friendliness: LE's "Too Many Requests" from certbot output is
// caught → status "failed" with a "try again in an hour" message.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as dns } from "dns";
import { promises as fs } from "fs";
import { spawn } from "child_process";
import { existsSync } from "fs";

// Where custom-domain server blocks live. nginx.conf includes
// /etc/nginx/conf.d/coach-domains.conf which pulls this dir. If the dir moves,
// update the sudoers rule too (/etc/sudoers.d/chessguru-domains).
const NGINX_DIR = process.env.COACH_NGINX_DIR ?? "/etc/nginx/coach-domains";
// LE live-cert path. Certbot creates <LE_LIVE>/<domain>/fullchain.pem etc.
const LE_LIVE = "/etc/letsencrypt/live";
// The web root ACME challenges are dropped into. Default HTTP server has a
// location /.well-known/acme-challenge/ { alias /var/www/acme/; } — covering
// any hostname before the coach-domain server block exists.
const ACME_WEBROOT = process.env.ACME_WEBROOT ?? "/var/www/acme";
// SPA root for custom domains. The SPA is deployed to /var/www/chessguru with
// vite base=/ (see v2/scripts/deploy.sh); the /v2/ prefix build lives at
// /var/www/chessguru-v2. Custom domains behave like the root site (base=/).
const SPA_ROOT = process.env.COACH_SPA_ROOT ?? "/var/www/chessguru";
// CNAME target we tell coaches to point their domain at.
export const CNAME_TARGET = process.env.COACH_CNAME_TARGET ?? "coach.dreamcy.com";
// Our A record (fallback for coaches that use A instead of CNAME).
const A_TARGET = process.env.COACH_A_TARGET ?? "213.32.21.226";
// Email LE will contact on cert-expiry warnings etc.
const LE_EMAIL = process.env.LE_EMAIL ?? "owner@dreamcy.com";

// Strict hostname regex — every char that reaches spawn() must match this.
// - lower-case letters, digits, hyphens; no leading/trailing hyphen per label
// - at least one dot (i.e. eTLD required)
// - ≤ 253 chars overall (RFC 1035)
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function validDomain(raw: string): string | null {
  const d = String(raw || "").trim().toLowerCase();
  if (!d || d.length > 253) return null;
  if (!DOMAIN_RE.test(d)) return null;
  // Block our own zones — a coach can't hijack harinitharanjith.com etc.
  const blocked = ["harinitharanjith.com", "dreamcy.com", "dreamworldplants.com", "dreamworldplants.in"];
  for (const b of blocked) if (d === b || d.endsWith(`.${b}`)) return null;
  return d;
}

@Injectable()
export class CoachDomainService {
  // In-process set — cheap guard against two concurrent provision jobs on the
  // same domain (e.g. impatient double-click on Verify). Not durable across
  // restarts; the mongo status field is the source of truth.
  private inflight = new Set<string>();

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("coachProfiles"); }

  private ensureCoachOrOwner(session: any): { userId: string } {
    const role = session?.role;
    const userId = session?.userId;
    if (!userId) throw new ForbiddenException("sign in first");
    if (role !== "coach" && role !== "academy_owner") throw new ForbiddenException("coach or owner only");
    return { userId };
  }

  /* -------------------------------------------------------------- set */

  async setDomain(session: any, body: any) {
    const { userId } = this.ensureCoachOrOwner(session);
    const domain = validDomain(body?.domain);
    if (!domain) throw new BadRequestException("invalid domain — use e.g. yourname.com (lowercase, no protocol)");

    // Domain uniqueness — two coaches can't own the same host.
    const clash: any = await this.col().findOne({ _id: { $ne: userId as any }, customDomain: domain });
    if (clash) throw new BadRequestException("that domain is already registered by another coach");

    await this.col().updateOne(
      { _id: userId as any },
      {
        $set: {
          customDomain: domain,
          customDomainStatus: "pending_dns",
          customDomainAddedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
        $setOnInsert: { _id: userId },
      },
      { upsert: true },
    );
    return this.status(session);
  }

  /* ----------------------------------------------------------- verify */

  async verify(session: any) {
    const { userId } = this.ensureCoachOrOwner(session);
    const doc: any = await this.col().findOne({ _id: userId as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (!domain) throw new BadRequestException("no domain set — POST /domain/set first");

    // Try CNAME first (preferred — coach doesn't have to update on IP changes),
    // then A record. Node's dns/promises throws ENOTFOUND on empty resolves;
    // catch and treat as "not yet set".
    let ok = false;
    let observed: string | null = null;
    try {
      const cnames = await dns.resolveCname(domain);
      observed = cnames.join(",");
      // Match either "coach.dreamcy.com" or "coach.dreamcy.com." (trailing dot).
      const norm = cnames.map((s) => s.replace(/\.$/, "").toLowerCase());
      if (norm.includes(CNAME_TARGET.toLowerCase())) ok = true;
    } catch { /* no CNAME — try A next */ }
    if (!ok) {
      try {
        const ips = await dns.resolve4(domain);
        observed = observed ? `${observed} / A=${ips.join(",")}` : `A=${ips.join(",")}`;
        if (ips.includes(A_TARGET)) ok = true;
      } catch { /* no A either */ }
    }

    if (!ok) {
      await this.col().updateOne(
        { _id: userId as any },
        {
          $set: {
            customDomainStatus: "pending_dns",
            customDomainLastCheckedAt: new Date(),
            customDomainError: `DNS not pointing here yet (observed: ${observed || "no record"}). Add CNAME → ${CNAME_TARGET} or A → ${A_TARGET}. DNS updates take 5-30 min.`,
            updatedAt: new Date(),
          },
        },
      );
      return this.status(session);
    }

    // Passed DNS — flip to provisioning and fire the background worker. The
    // HTTP request returns immediately; the client polls /status every 5s.
    await this.col().updateOne(
      { _id: userId as any },
      {
        $set: {
          customDomainStatus: "provisioning",
          customDomainLastCheckedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
      },
    );
    // Non-blocking. setImmediate keeps the response cycle clean; the worker
    // logs to pm2 stdout so failures are debuggable via `pm2 logs`.
    setImmediate(() => this.provision(userId, domain).catch((e) => {
      console.error(`[coach-domain] provision crash ${domain}:`, e);
    }));

    return this.status(session);
  }

  /* ---------------------------------------------------------- status */

  async status(session: any) {
    const { userId } = this.ensureCoachOrOwner(session);
    const doc: any = (await this.col().findOne({ _id: userId as any })) || {};
    return {
      domain: String(doc.customDomain || ""),
      status: String(doc.customDomainStatus || ""),
      addedAt: doc.customDomainAddedAt || null,
      lastCheckedAt: doc.customDomainLastCheckedAt || null,
      activatedAt: doc.customDomainActivatedAt || null,
      error: String(doc.customDomainError || ""),
      cnameTarget: CNAME_TARGET,
      aTarget: A_TARGET,
    };
  }

  /* ---------------------------------------------------------- remove */

  async remove(session: any) {
    const { userId } = this.ensureCoachOrOwner(session);
    const doc: any = await this.col().findOne({ _id: userId as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (domain) {
      // Best-effort cleanup — never throw on missing files (idempotent).
      const confPath = `${NGINX_DIR}/${domain}.conf`;
      if (existsSync(confPath)) {
        await this.run("sudo", ["-n", "/bin/rm", confPath]).catch(() => null);
      }
      await this.run("sudo", ["-n", "/usr/bin/certbot", "delete", "--cert-name", domain, "--non-interactive"]).catch(() => null);
      await this.run("sudo", ["-n", "/usr/sbin/nginx", "-t"]).catch(() => null);
      await this.run("sudo", ["-n", "/bin/systemctl", "reload", "nginx"]).catch(() => null);
    }
    await this.col().updateOne(
      { _id: userId as any },
      {
        $set: {
          customDomain: "",
          customDomainStatus: "",
          customDomainError: "",
          customDomainAddedAt: null,
          customDomainActivatedAt: null,
          updatedAt: new Date(),
        },
      },
    );
    return this.status(session);
  }

  /* -------------------------------------------- public by-domain lookup */

  async lookupByDomain(rawDomain: string): Promise<{ username: string } | null> {
    const domain = validDomain(rawDomain);
    if (!domain) return null;
    const doc: any = await this.col().findOne(
      { customDomain: domain, customDomainStatus: "active" },
      { projection: { _id: 1 } },
    );
    if (!doc?._id) return null;
    const user: any = await this.conn.db!.collection("users").findOne(
      { _id: doc._id as any },
      { projection: { username: 1 } },
    );
    if (!user?.username) return null;
    return { username: String(user.username) };
  }

  /* =========================================================== worker */

  private async provision(userId: string, domain: string) {
    // Reject concurrent provisions for the same domain (impatient re-clicks).
    if (this.inflight.has(domain)) return;
    this.inflight.add(domain);
    try {
      // Step 1: issue cert via HTTP-01 webroot.
      const cert = await this.run("sudo", [
        "-n",
        "/usr/bin/certbot", "certonly", "--webroot",
        "-w", ACME_WEBROOT,
        "--non-interactive",
        "--agree-tos",
        "--email", LE_EMAIL,
        "-d", domain,
      ]);
      if (cert.code !== 0) {
        // Parse rate-limit messages for a friendlier error.
        const combined = `${cert.stdout}\n${cert.stderr}`;
        const rate = /too many|rate.?limit|429/i.test(combined);
        const msg = rate
          ? "Let's Encrypt is rate-limited on this domain — try again in about an hour."
          : `SSL issuance failed: ${combined.split("\n").slice(-6).join(" | ").slice(0, 400)}`;
        await this.markFailed(userId, msg);
        return;
      }
      // Confirm the cert file exists.
      const fullchain = `${LE_LIVE}/${domain}/fullchain.pem`;
      if (!existsSync(fullchain)) {
        await this.markFailed(userId, "cert file missing after certbot ran — check pm2 logs");
        return;
      }

      // Step 2: write nginx server block via `sudo tee` (only path ubuntu can
      // write into NGINX_DIR is via the tee sudoers rule).
      const conf = this.buildNginxConf(domain);
      const write = await this.runWithStdin(
        "sudo",
        ["-n", "/usr/bin/tee", `${NGINX_DIR}/${domain}.conf`],
        conf,
      );
      if (write.code !== 0) {
        await this.markFailed(userId, `failed to write nginx conf: ${write.stderr.slice(0, 200)}`);
        return;
      }

      // Step 3: nginx -t → if fail, delete the conf and mark failed.
      const test = await this.run("sudo", ["-n", "/usr/sbin/nginx", "-t"]);
      if (test.code !== 0) {
        await this.run("sudo", ["-n", "/bin/rm", `${NGINX_DIR}/${domain}.conf`]).catch(() => null);
        await this.markFailed(userId, `nginx config test failed: ${(test.stderr || test.stdout).slice(0, 200)}`);
        return;
      }

      // Step 4: reload.
      const reload = await this.run("sudo", ["-n", "/bin/systemctl", "reload", "nginx"]);
      if (reload.code !== 0) {
        await this.markFailed(userId, `nginx reload failed: ${(reload.stderr || reload.stdout).slice(0, 200)}`);
        return;
      }

      // All good.
      await this.col().updateOne(
        { _id: userId as any },
        {
          $set: {
            customDomainStatus: "active",
            customDomainActivatedAt: new Date(),
            customDomainError: "",
            updatedAt: new Date(),
          },
        },
      );
      console.log(`[coach-domain] provisioned ${domain} for user ${userId}`);
    } catch (e: any) {
      await this.markFailed(userId, `unexpected error: ${String(e?.message || e).slice(0, 200)}`);
    } finally {
      this.inflight.delete(domain);
    }
  }

  private async markFailed(userId: string, msg: string) {
    await this.col().updateOne(
      { _id: userId as any },
      {
        $set: {
          customDomainStatus: "failed",
          customDomainError: msg,
          updatedAt: new Date(),
        },
      },
    );
    console.error(`[coach-domain] user ${userId}: ${msg}`);
  }

  private buildNginxConf(domain: string): string {
    // domain has already passed DOMAIN_RE — no shell-metacharacters possible.
    // Even so we use no user input for the conf outside this validated string.
    return `# Auto-generated ${new Date().toISOString()} by coach-domain.service.
# Coach custom-domain SSL vhost for ${domain}. Delete via /api/me/coach-profile/domain/remove.
server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
  location /.well-known/acme-challenge/ { alias ${ACME_WEBROOT}/; }
  location / { return 301 https://$host$request_uri; }
}
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name ${domain};
  http2 on;

  ssl_certificate     ${LE_LIVE}/${domain}/fullchain.pem;
  ssl_certificate_key ${LE_LIVE}/${domain}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;

  # The SPA sits at ${SPA_ROOT} (vite base=/). On mount, App.tsx reads
  # location.hostname; when the hostname isn't ours, it GETs /v2api/coach/by-domain/<host>
  # and navigate()s to /coach/<username>. Deep links (e.g. /coach/foo) also work.
  root ${SPA_ROOT};
  index index.html;
  location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache" always; }
  location /assets/ { try_files $uri =404; }

  location /coach-img/ {
    alias /home/ubuntu/chessguru-coach-images/;
    add_header Cache-Control "public, max-age=86400";
    access_log off;
  }

  location /v2api/ {
    proxy_pass http://localhost:4000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Custom-Domain $host;
    proxy_read_timeout 3600;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
  }
}
`;
  }

  /** spawn wrapper — argv only, never a shell string. Captures both streams. */
  private run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { shell: false });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => { stdout += d.toString(); });
      p.stderr.on("data", (d) => { stderr += d.toString(); });
      p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      p.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e?.message || e) }));
    });
  }

  private runWithStdin(cmd: string, args: string[], stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const p = spawn(cmd, args, { shell: false });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => { stdout += d.toString(); });
      p.stderr.on("data", (d) => { stderr += d.toString(); });
      p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      p.on("error", (e) => resolve({ code: -1, stdout, stderr: String(e?.message || e) }));
      p.stdin.write(stdin);
      p.stdin.end();
    });
  }
}
