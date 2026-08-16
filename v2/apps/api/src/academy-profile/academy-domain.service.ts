// Academy custom-domain automation (2026-08-13).
//
// Mirrors coach-domain.service — same DNS → certbot → nginx-block flow, same
// sudoers rules (reused). Differences:
//   - keyed off session.academyId (not userId)
//   - writes to `academyProfiles` (not coachProfiles)
//   - lookupByDomain returns { slug } (SPA shim routes → /academy-page/:slug)
//
// The two services share the same NGINX_DIR (`/etc/nginx/coach-domains`) so
// the existing sudoers rule + nginx include cover both. That keeps ops simple:
// one place to look, one rule to audit. Both filenames are the domain, so
// there's no name collision (a coach can't own the same domain an academy
// owns thanks to the cross-collection uniqueness check inside setDomain).

import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { promises as dns } from "dns";
import { spawn } from "child_process";
import { existsSync } from "fs";

const NGINX_DIR = process.env.COACH_NGINX_DIR ?? "/etc/nginx/coach-domains";
const LE_LIVE = "/etc/letsencrypt/live";
const ACME_WEBROOT = process.env.ACME_WEBROOT ?? "/var/www/acme";
const SPA_ROOT = process.env.COACH_SPA_ROOT ?? "/var/www/chessguru";
export const CNAME_TARGET = process.env.COACH_CNAME_TARGET ?? "coach.dreamcy.com";
const A_TARGET = process.env.COACH_A_TARGET ?? "213.32.21.226";
const LE_EMAIL = process.env.LE_EMAIL ?? "owner@dreamcy.com";

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const TEST_ALLOWLIST = new Set(["test-academy.dreamcy.com"]);

function validDomain(raw: string): string | null {
  const d = String(raw || "").trim().toLowerCase();
  if (!d || d.length > 253) return null;
  if (!DOMAIN_RE.test(d)) return null;
  if (TEST_ALLOWLIST.has(d)) return d;
  const blocked = ["harinitharanjith.com", "dreamcy.com", "dreamworldplants.com", "dreamworldplants.in"];
  for (const b of blocked) if (d === b || d.endsWith(`.${b}`)) return null;
  return d;
}

@Injectable()
export class AcademyDomainService {
  private inflight = new Set<string>();

  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection("academyProfiles"); }
  private coachProfiles() { return this.conn.db!.collection("coachProfiles"); }

  private ensureOwner(session: any): { academyId: string } {
    const role = session?.role;
    const academyId = session?.academyId;
    if (!session?.userId) throw new ForbiddenException("sign in first");
    if (role !== "academy_owner" || !academyId) throw new ForbiddenException("academy owner only");
    return { academyId };
  }

  /** Gate check — superadmin can flip customDomainEnabled=false to block a
   *  specific academy from touching set/verify. Undefined = allowed (grandfather
   *  existing users). remove() intentionally skips this so a disabled academy
   *  can still tear down a stale record. */
  private async ensureFeatureEnabled(academyId: string) {
    const doc: any = await this.col().findOne(
      { _id: academyId as any },
      { projection: { customDomainEnabled: 1 } },
    );
    if (doc && doc.customDomainEnabled === false) {
      throw new ForbiddenException("Custom domains are not enabled for your academy — contact support");
    }
  }

  async setDomain(session: any, body: any) {
    const { academyId } = this.ensureOwner(session);
    await this.ensureFeatureEnabled(academyId);
    const domain = validDomain(body?.domain);
    if (!domain) throw new BadRequestException("invalid domain — use e.g. yourname.com (lowercase, no protocol)");

    // Cross-collection uniqueness — can't clash with another academy OR a coach.
    const otherAcademy: any = await this.col().findOne({ _id: { $ne: academyId as any }, customDomain: domain });
    if (otherAcademy) throw new BadRequestException("that domain is already registered by another academy");
    const clashCoach: any = await this.coachProfiles().findOne({ customDomain: domain });
    if (clashCoach) throw new BadRequestException("that domain is already used by a coach page");

    await this.col().updateOne(
      { _id: academyId as any },
      {
        $set: {
          customDomain: domain,
          customDomainStatus: "pending_dns",
          customDomainAddedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
        $setOnInsert: { _id: academyId },
      },
      { upsert: true },
    );
    return this.status(session);
  }

  async verify(session: any) {
    const { academyId } = this.ensureOwner(session);
    await this.ensureFeatureEnabled(academyId);
    const doc: any = await this.col().findOne({ _id: academyId as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (!domain) throw new BadRequestException("no domain set — POST /domain/set first");

    let ok = false;
    let observed: string | null = null;
    try {
      const cnames = await dns.resolveCname(domain);
      observed = cnames.join(",");
      const norm = cnames.map((s) => s.replace(/\.$/, "").toLowerCase());
      if (norm.includes(CNAME_TARGET.toLowerCase())) ok = true;
    } catch { /* no CNAME */ }
    if (!ok) {
      try {
        const ips = await dns.resolve4(domain);
        observed = observed ? `${observed} / A=${ips.join(",")}` : `A=${ips.join(",")}`;
        if (ips.includes(A_TARGET)) ok = true;
      } catch { /* no A */ }
    }

    if (!ok) {
      await this.col().updateOne(
        { _id: academyId as any },
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

    await this.col().updateOne(
      { _id: academyId as any },
      {
        $set: {
          customDomainStatus: "provisioning",
          customDomainLastCheckedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
      },
    );
    setImmediate(() => this.provision(academyId, domain).catch((e) => {
      console.error(`[academy-domain] provision crash ${domain}:`, e);
    }));

    return this.status(session);
  }

  async status(session: any) {
    const { academyId } = this.ensureOwner(session);
    const doc: any = (await this.col().findOne({ _id: academyId as any })) || {};
    return {
      domain: String(doc.customDomain || ""),
      status: String(doc.customDomainStatus || ""),
      addedAt: doc.customDomainAddedAt || null,
      lastCheckedAt: doc.customDomainLastCheckedAt || null,
      activatedAt: doc.customDomainActivatedAt || null,
      error: String(doc.customDomainError || ""),
      // undefined defaults to true (feature is on for existing academies unless
      // superadmin explicitly disables). Only explicit false hides the UI.
      enabled: doc.customDomainEnabled !== false,
      cnameTarget: CNAME_TARGET,
      aTarget: A_TARGET,
    };
  }

  /* -------------------------------------------------------- admin ops */
  // Superadmin call-through helpers (validation + provisioning stays here so
  // the AdminDomainService doesn't have to re-implement certbot/nginx).

  async adminSetDomainFor(academyId: string, rawDomain: string) {
    const id = String(academyId || "").trim().toLowerCase();
    if (!id) throw new BadRequestException("missing academyId");
    const domain = validDomain(rawDomain);
    if (!domain) throw new BadRequestException("invalid domain — use e.g. yourname.com (lowercase, no protocol)");
    const acad: any = await this.conn.db!.collection("academies").findOne({ _id: id as any }, { projection: { _id: 1 } });
    if (!acad) throw new BadRequestException("no such academy");

    const otherAcademy: any = await this.col().findOne({ _id: { $ne: id as any }, customDomain: domain });
    if (otherAcademy) throw new BadRequestException("that domain is already registered by another academy");
    const clashCoach: any = await this.coachProfiles().findOne({ customDomain: domain });
    if (clashCoach) throw new BadRequestException("that domain is already used by a coach page");

    await this.col().updateOne(
      { _id: id as any },
      {
        $set: {
          customDomain: domain,
          customDomainStatus: "pending_dns",
          customDomainAddedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );
    return { ok: true, academyId: id, domain, status: "pending_dns" };
  }

  async adminVerifyFor(academyId: string) {
    const id = String(academyId || "").trim().toLowerCase();
    const doc: any = await this.col().findOne({ _id: id as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (!domain) throw new BadRequestException("no domain set for this academy");

    let ok = false;
    let observed: string | null = null;
    try {
      const cnames = await dns.resolveCname(domain);
      observed = cnames.join(",");
      const norm = cnames.map((s) => s.replace(/\.$/, "").toLowerCase());
      if (norm.includes(CNAME_TARGET.toLowerCase())) ok = true;
    } catch { /* no CNAME */ }
    if (!ok) {
      try {
        const ips = await dns.resolve4(domain);
        observed = observed ? `${observed} / A=${ips.join(",")}` : `A=${ips.join(",")}`;
        if (ips.includes(A_TARGET)) ok = true;
      } catch { /* no A */ }
    }

    if (!ok) {
      await this.col().updateOne(
        { _id: id as any },
        {
          $set: {
            customDomainStatus: "pending_dns",
            customDomainLastCheckedAt: new Date(),
            customDomainError: `DNS not pointing here yet (observed: ${observed || "no record"}). Add CNAME → ${CNAME_TARGET} or A → ${A_TARGET}. DNS updates take 5-30 min.`,
            updatedAt: new Date(),
          },
        },
      );
      return { ok: false, status: "pending_dns", observed };
    }

    await this.col().updateOne(
      { _id: id as any },
      {
        $set: {
          customDomainStatus: "provisioning",
          customDomainLastCheckedAt: new Date(),
          customDomainError: "",
          updatedAt: new Date(),
        },
      },
    );
    setImmediate(() => this.provision(id, domain).catch((e) => {
      console.error(`[academy-domain] admin-triggered provision crash ${domain}:`, e);
    }));
    return { ok: true, status: "provisioning" };
  }

  async adminRemoveFor(academyId: string) {
    const id = String(academyId || "").trim().toLowerCase();
    const doc: any = await this.col().findOne({ _id: id as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (domain) {
      const confPath = `${NGINX_DIR}/${domain}.conf`;
      if (existsSync(confPath)) {
        await this.run("sudo", ["-n", "/bin/rm", confPath]).catch(() => null);
      }
      await this.run("sudo", ["-n", "/usr/bin/certbot", "delete", "--cert-name", domain, "--non-interactive"]).catch(() => null);
      await this.run("sudo", ["-n", "/usr/sbin/nginx", "-t"]).catch(() => null);
      await this.run("sudo", ["-n", "/bin/systemctl", "reload", "nginx"]).catch(() => null);
    }
    await this.col().updateOne(
      { _id: id as any },
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
    return { ok: true };
  }

  async adminSetEnabled(academyId: string, enabled: boolean) {
    const id = String(academyId || "").trim().toLowerCase();
    if (!id) throw new BadRequestException("missing academyId");
    const acad: any = await this.conn.db!.collection("academies").findOne({ _id: id as any }, { projection: { _id: 1 } });
    if (!acad) throw new BadRequestException("no such academy");
    await this.col().updateOne(
      { _id: id as any },
      {
        $set: { customDomainEnabled: !!enabled, updatedAt: new Date() },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );
    return { ok: true, academyId: id, customDomainEnabled: !!enabled };
  }

  async remove(session: any) {
    const { academyId } = this.ensureOwner(session);
    const doc: any = await this.col().findOne({ _id: academyId as any });
    const domain = doc?.customDomain ? validDomain(doc.customDomain) : null;
    if (domain) {
      const confPath = `${NGINX_DIR}/${domain}.conf`;
      if (existsSync(confPath)) {
        await this.run("sudo", ["-n", "/bin/rm", confPath]).catch(() => null);
      }
      await this.run("sudo", ["-n", "/usr/bin/certbot", "delete", "--cert-name", domain, "--non-interactive"]).catch(() => null);
      await this.run("sudo", ["-n", "/usr/sbin/nginx", "-t"]).catch(() => null);
      await this.run("sudo", ["-n", "/bin/systemctl", "reload", "nginx"]).catch(() => null);
    }
    await this.col().updateOne(
      { _id: academyId as any },
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

  /** Public by-domain lookup — returns { slug } so the SPA shim can navigate
   *  to /academy-page/<slug>. Academy _id IS the slug. */
  async lookupByDomain(rawDomain: string): Promise<{ slug: string } | null> {
    const domain = validDomain(rawDomain);
    if (!domain) return null;
    const doc: any = await this.col().findOne(
      { customDomain: domain, customDomainStatus: "active" },
      { projection: { _id: 1 } },
    );
    if (!doc?._id) return null;
    return { slug: String(doc._id) };
  }

  private async provision(academyId: string, domain: string) {
    if (this.inflight.has(domain)) return;
    this.inflight.add(domain);
    try {
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
        const combined = `${cert.stdout}\n${cert.stderr}`;
        const rate = /too many|rate.?limit|429/i.test(combined);
        const msg = rate
          ? "Let's Encrypt is rate-limited on this domain — try again in about an hour."
          : `SSL issuance failed: ${combined.split("\n").slice(-6).join(" | ").slice(0, 400)}`;
        await this.markFailed(academyId, msg);
        return;
      }

      // Pull displayName for the sub_filter that templates the tenant name
      // into the served <title> — eliminates the "ChessGuru" flash on first
      // visit before JS runs. Fall back to the academy slug if no profile yet.
      const prof: any = await this.conn.db!
        .collection("academyProfiles")
        .findOne({ _id: academyId as any }, { projection: { displayName: 1 } });
      const displayName = String(prof?.displayName || academyId).trim();
      const conf = this.buildNginxConf(domain, String(academyId), displayName);
      const write = await this.runWithStdin(
        "sudo",
        ["-n", "/usr/bin/tee", `${NGINX_DIR}/${domain}.conf`],
        conf,
      );
      if (write.code !== 0) {
        await this.markFailed(academyId, `failed to write nginx conf: ${write.stderr.slice(0, 200)}`);
        return;
      }

      const test = await this.run("sudo", ["-n", "/usr/sbin/nginx", "-t"]);
      if (test.code !== 0) {
        await this.run("sudo", ["-n", "/bin/rm", `${NGINX_DIR}/${domain}.conf`]).catch(() => null);
        await this.markFailed(academyId, `nginx config test failed: ${(test.stderr || test.stdout).slice(0, 200)}`);
        return;
      }

      const reload = await this.run("sudo", ["-n", "/bin/systemctl", "reload", "nginx"]);
      if (reload.code !== 0) {
        await this.markFailed(academyId, `nginx reload failed: ${(reload.stderr || reload.stdout).slice(0, 200)}`);
        return;
      }

      await this.col().updateOne(
        { _id: academyId as any },
        {
          $set: {
            customDomainStatus: "active",
            customDomainActivatedAt: new Date(),
            customDomainError: "",
            updatedAt: new Date(),
          },
        },
      );
      console.log(`[academy-domain] provisioned ${domain} for academy ${academyId}`);
    } catch (e: any) {
      await this.markFailed(academyId, `unexpected error: ${String(e?.message || e).slice(0, 200)}`);
    } finally {
      this.inflight.delete(domain);
    }
  }

  private async markFailed(academyId: string, msg: string) {
    await this.col().updateOne(
      { _id: academyId as any },
      {
        $set: {
          customDomainStatus: "failed",
          customDomainError: msg,
          updatedAt: new Date(),
        },
      },
    );
    console.error(`[academy-domain] academy ${academyId}: ${msg}`);
  }

  private buildNginxConf(domain: string, slug: string, displayName: string = ""): string {
    // Same SPA vhost shape as coach-domain, plus /academy-img/ alias. The SPA
    // shim in App.tsx will look up /v2api/academy-page/by-domain/<host> on
    // mount and navigate() to /academy-page/<slug>.
    // Escape the tenant name for nginx string literal (backslash, dquote).
    const safeName = String(displayName || slug)
      .replace(/\\/g, "\\\\").replace(/"/g, "\\\"").slice(0, 120);
    return `# Auto-generated ${new Date().toISOString()} by academy-domain.service.
# Academy custom-domain SSL vhost for ${domain}. Delete via /api/me/academy-profile/domain/remove.
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

  root ${SPA_ROOT};
  index index.html;
  # Server-side tenant landing (no client-side flash): / goes straight to the
  # academy public page for this tenant.
  location = / { return 302 /academy-page/${slug}; }
  # /v2/ prefix retired 2026-08-15 — legacy URLs 301 to root.
  location = /v2 { return 301 /; }
  location /v2/ { rewrite ^/v2/(.*)$ /$1 permanent; }
  # sub_filter templates the tenant name into the SERVED index.html so the
  # browser tab never shows "ChessGuru" before JS runs. Applies only to
  # text/html; asset responses are untouched.
  location / {
    try_files $uri /index.html;
    add_header Cache-Control "no-cache" always;
    sub_filter_once off;
    sub_filter "<title>ChessGuru — Puzzle Trainer</title>" "<title>${safeName}</title>";
    sub_filter "content=\\"ChessGuru\\"" "content=\\"${safeName}\\"";
  }
  location /assets/ { try_files $uri =404; }

  location /coach-img/ {
    alias /home/ubuntu/chessguru-coach-images/;
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
