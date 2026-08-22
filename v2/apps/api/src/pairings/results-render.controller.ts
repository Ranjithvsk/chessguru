// /render/results/* — server-side rendered HTML for search-engine crawlers.
// Nginx routes bot User-Agents here; humans get the client-side SPA at the
// same URL. Purpose: chess-results.com has 20 years of Google-indexed
// tournament pages; the only way to compete is to make our pages equally
// crawlable from day one.
//
// Renders a complete self-contained HTML doc with:
//   • <title> + meta description + Open Graph tags
//   • JSON-LD SportsEvent structured data
//   • Full crosstable + standings + pairings inlined as semantic HTML
//   • Zero JavaScript required to see the data (progressive enhancement:
//     the browser SPA will still hydrate on top for human visitors, but
//     bots see a full-content HTML doc immediately)

import { Controller, Get, Header, Param, Res } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

function pubStandings(t: any) {
  const P = t.players.length;
  const points = new Array<number>(P + 1).fill(0);
  const opps: number[][] = Array.from({ length: P + 1 }, () => []);
  for (const r of t.rounds || []) {
    for (const g of r.pairings) {
      const res = g.result; if (!res) continue;
      const wp = res === "1" || res === "+" ? 1 : res === "=" ? 0.5 : 0;
      const bp = res === "0" || res === "-" ? 1 : res === "=" ? 0.5 : 0;
      if (g.white_rank >= 1) { points[g.white_rank] = (points[g.white_rank] || 0) + wp; if (g.black_rank) opps[g.white_rank]!.push(g.black_rank); }
      if (g.black_rank >= 1) { points[g.black_rank] = (points[g.black_rank] || 0) + bp; if (g.white_rank) opps[g.black_rank]!.push(g.white_rank); }
    }
  }
  const rows = t.players.map((p: any) => {
    const buch = (opps[p.rank] || []).reduce((s, o) => s + (points[o] || 0), 0);
    return { rank: p.rank, name: p.name, title: p.title || "", rating: p.rating || 0, federation: p.federation || "", points: points[p.rank] || 0, buchholz: +buch.toFixed(1) };
  });
  rows.sort((a: any, b: any) => b.points - a.points || b.buchholz - a.buchholz || b.rating - a.rating);
  return rows.map((r: any, i: number) => ({ ...r, place: i + 1 }));
}

@Controller()
export class ResultsRenderController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  /** Bot-friendly HTML for one tournament. Served at results.chessguru.cc/t/:id
   *  when nginx routes crawler user-agents here. Complete document — no JS. */
  @Get("render/results/t/:id")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async tournamentHtml(@Param("id") id: string, @Res() res: any) {
    let _id: any;
    try { _id = new Types.ObjectId(id); } catch { res.status(404).send(notFoundHtml()); return; }
    const t = await this.conn.db!.collection("sm_tournaments").findOne({ _id, is_public: true });
    if (!t) { res.status(404).send(notFoundHtml()); return; }

    const standings = pubStandings(t);
    const nameByRank = new Map<number, string>(t.players.map((p: any) => [p.rank, p.name]));
    const dateRange = t.start_date === t.end_date ? t.start_date : `${t.start_date} → ${t.end_date}`;
    const title = `${t.name} — ${t.city || ""} — ChessGuru Results`;
    const desc = `${t.name}. ${t.players.length} players, ${t.num_rounds} rounds. ${t.city ? `Held in ${t.city}. ` : ""}${t.rating_type} rated. Live crosstable, standings and round pairings.`;
    const url = `https://results.chessguru.cc/t/${t._id}`;

    // JSON-LD: schema.org/SportsEvent is what chess-results.com does NOT do —
    // easy SEO win. Google surfaces these in rich results for chess queries.
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: t.name,
      startDate: t.start_date?.replace(/\//g, "-"),
      endDate: t.end_date?.replace(/\//g, "-"),
      location: t.city ? { "@type": "Place", name: t.city, address: { "@type": "PostalAddress", addressCountry: t.federation || "IND" } } : undefined,
      sport: "Chess",
      organizer: t.chief_arbiter ? { "@type": "Person", name: t.chief_arbiter } : undefined,
      url,
      description: desc,
    };

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(t.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="ChessGuru Results">
<meta property="og:image" content="https://results.chessguru.cc/og/${t._id}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t.name)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://results.chessguru.cc/og/${t._id}.png">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 1rem; color: #1c1917; background: #fefbf6; }
  h1 { margin: 0.25rem 0; font-size: 1.75rem; }
  .meta { color: #57534e; font-size: 0.9rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #e7e5e4; text-align: left; }
  th { background: #f5f5f4; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  tr.place-1 { background: rgba(251, 191, 36, 0.15); font-weight: 600; }
  tr.place-2 { background: rgba(148, 163, 184, 0.12); }
  tr.place-3 { background: rgba(217, 119, 6, 0.10); }
  h2 { margin-top: 2rem; border-bottom: 2px solid #d6d3d1; padding-bottom: 0.25rem; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e7e5e4; color: #78716c; font-size: 0.8rem; text-align: center; }
  a { color: #7c3aed; }
</style>
</head>
<body>
<nav><a href="https://results.chessguru.cc/">← All tournaments</a></nav>
<h1>${esc(t.name)}</h1>
<div class="meta">
  ${esc(t.city || "")} · ${esc(t.federation || "")} · ${esc(dateRange || "")} ·
  ${esc(t.rating_type)} · ${t.players.length} players · ${t.rounds?.length || 0} of ${t.num_rounds} rounds played
  ${t.chief_arbiter ? ` · Chief Arbiter: ${esc(t.chief_arbiter)}` : ""}
</div>

<h2>Standings</h2>
<table>
<thead><tr><th>Place</th><th>Name</th><th>Title</th><th>Rating</th><th>Fed</th><th>Points</th><th>Buchholz</th></tr></thead>
<tbody>
${standings.map((s: any) => `<tr class="place-${s.place}"><td>${s.place}</td><td>${esc(s.name)}</td><td>${esc(s.title)}</td><td>${s.rating || "—"}</td><td>${esc(s.federation)}</td><td>${s.points.toFixed(1)}</td><td>${s.buchholz.toFixed(1)}</td></tr>`).join("\n")}
</tbody>
</table>

${(t.rounds || []).map((r: any) => `
<h2>Round ${r.round_no}</h2>
<table>
<thead><tr><th>Bd</th><th>White</th><th>Result</th><th>Black</th></tr></thead>
<tbody>
${r.pairings.map((g: any) => `<tr><td>${g.board}</td><td>${esc(nameByRank.get(g.white_rank) || "?")}</td><td>${g.black_rank === 0 ? "bye" : (g.result || "—")}</td><td>${g.black_rank ? esc(nameByRank.get(g.black_rank) || "?") : "—"}</td></tr>`).join("\n")}
</tbody>
</table>
`).join("\n")}

<div class="footer">
Powered by <a href="https://chessguru.cc/">ChessGuru</a> — FIDE-endorsed JaVaFo pairing engine · TRF16 export · publish to chess-results.com.
Arbiters: <a href="https://chessguru.cc/arbiter">Run your own tournament →</a>
</div>
</body>
</html>`;
    res.send(html);
  }

  /** Bot-friendly homepage: recent + running-now tournaments. */
  @Get("render/results/")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=120")
  async homeHtml(@Res() res: any) {
    const rows = await this.conn.db!.collection("sm_tournaments").find({ is_public: true }).sort({ updated_at: -1 }).limit(50).toArray();
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ChessGuru Results — India chess tournament crosstables + standings</title>
<meta name="description" content="Live standings, crosstables and pairings from FIDE / AICF / state chess tournaments across India. Free, mobile-friendly, no login. Powered by JaVaFo pairing engine.">
<link rel="canonical" href="https://results.chessguru.cc/">
<meta property="og:title" content="ChessGuru Results">
<meta property="og:description" content="Live standings, crosstables and pairings from FIDE / AICF / state chess tournaments across India.">
<meta property="og:url" content="https://results.chessguru.cc/">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1100px; margin: 0 auto; padding: 1rem; color: #1c1917; background: #fefbf6; }
  h1 { margin: 0.25rem 0; }
  .tagline { color: #57534e; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 0.75rem; }
  .card { border: 1px solid #e7e5e4; border-radius: 12px; padding: 1rem; text-decoration: none; color: inherit; background: #fff; }
  .card:hover { border-color: #7c3aed; }
  .card .name { font-weight: 600; }
  .card .meta { color: #78716c; font-size: 0.85rem; margin-top: 0.25rem; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e7e5e4; color: #78716c; font-size: 0.8rem; text-align: center; }
  a { color: #7c3aed; }
</style>
</head>
<body>
<h1>♟ ChessGuru Results</h1>
<div class="tagline">Live standings, crosstables and round pairings from Indian chess tournaments. Free · no login · mobile-friendly.</div>
<div class="grid">
${rows.map((t: any) => `
<a class="card" href="/t/${t._id}">
  <div class="name">${esc(t.name)}</div>
  <div class="meta">
    ${esc(t.city || "")} · ${esc(t.federation || "IND")} · ${esc(t.rating_type)} ·
    ${t.players?.length || 0} players · Round ${t.rounds?.length || 0}/${t.num_rounds}
  </div>
</a>`).join("")}
</div>
<div class="footer">
Powered by <a href="https://chessguru.cc/">ChessGuru</a> · FIDE Dutch Swiss pairings via JaVaFo · <a href="https://chessguru.cc/arbiter">Arbiters: run your own tournament →</a>
</div>
</body>
</html>`;
    res.send(html);
  }

  /** OG image PNG (1200x630) for one tournament — used in social sharing
   *  previews (WhatsApp / Twitter / FB / LinkedIn / Slack). Rendered via
   *  Satori (React → SVG) then Resvg (SVG → PNG). ~200ms per render, cached
   *  for 1h on the CDN edge. */
  @Get("render/results/og/:id")
  @Header("Content-Type", "image/png")
  @Header("Cache-Control", "public, max-age=3600")
  async ogImage(@Param("id") id: string, @Res() res: any) {
    let _id: any;
    try { _id = new Types.ObjectId(id); } catch { res.status(404).send(""); return; }
    const t = await this.conn.db!.collection("sm_tournaments").findOne({ _id, is_public: true });
    if (!t) { res.status(404).send(""); return; }
    const standings = pubStandings(t);
    const top = standings.slice(0, 8);
    const font = await loadFont();
    // Satori JSX renders as plain objects; no JSX transpile step needed.
    const el: any = {
      type: "div",
      props: {
        style: {
          width: 1200, height: 630, display: "flex", flexDirection: "column",
          background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #fbbf24 100%)",
          padding: 48, fontFamily: "Inter", color: "white",
        },
        children: [
          { type: "div", props: { style: { fontSize: 24, opacity: 0.9, letterSpacing: 2, marginBottom: 12 }, children: `♟ CHESSGURU · ${t.rating_type || "RATED"} · ${t.federation || "IND"}` } },
          { type: "div", props: { style: { fontSize: 60, fontWeight: 700, lineHeight: 1.1, marginBottom: 8 }, children: t.name } },
          { type: "div", props: { style: { fontSize: 26, opacity: 0.85, marginBottom: 24 }, children: `${t.city || ""} · ${t.start_date || ""}${t.start_date !== t.end_date ? " → " + t.end_date : ""} · ${t.players.length} players · ${t.rounds?.length || 0}/${t.num_rounds} rounds` } },
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.35)", borderRadius: 20, padding: 24, marginTop: 8 },
              children: [
                { type: "div", props: { style: { fontSize: 20, opacity: 0.9, marginBottom: 12 }, children: "STANDINGS" } },
                ...top.map((s: any) => ({
                  type: "div",
                  props: {
                    style: { display: "flex", fontSize: 22, marginBottom: 6 },
                    children: [
                      { type: "div", props: { style: { width: 48, fontWeight: 700 }, children: String(s.place) } },
                      { type: "div", props: { style: { flex: 1, overflow: "hidden" }, children: s.name.slice(0, 32) } },
                      { type: "div", props: { style: { width: 90, textAlign: "right", fontFamily: "monospace" }, children: (s.rating || "—").toString() } },
                      { type: "div", props: { style: { width: 70, textAlign: "right", fontWeight: 700 }, children: s.points.toFixed(1) } },
                    ],
                  },
                })),
              ],
            },
          },
          { type: "div", props: { style: { position: "absolute", bottom: 32, right: 48, fontSize: 20, opacity: 0.9 }, children: "results.chessguru.cc" } },
        ],
      },
    };
    const svg = await satori(el, { width: 1200, height: 630, fonts: [{ name: "Inter", data: font, weight: 400, style: "normal" }] });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
    res.send(png);
  }

  /** SEO HTML for one player — every public tournament they've appeared in
   *  plus career aggregates. Bot-served at results.chessguru.cc/player/:fide_id. */
  @Get("render/results/player/:fide_id")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async playerHtml(@Param("fide_id") fideId: string, @Res() res: any) {
    // Reuse the shape of the public JSON endpoint via a lightweight local
    // computation so we don't have to make an internal HTTP call.
    const rows = await this.conn.db!.collection("sm_tournaments").find({ is_public: true, "players.fide_id": fideId }).sort({ end_date: -1 }).limit(200).toArray();
    let name = "";
    let games = 0, wins = 0, losses = 0, draws = 0;
    let oppRatingSum = 0, oppRatingCount = 0;
    const events: any[] = [];
    for (const t of rows) {
      const p = t.players.find((x: any) => x.fide_id === fideId);
      if (!p) continue;
      if (!name) name = p.name;
      let pts = 0, gm = 0;
      for (const r of t.rounds || []) {
        for (const g of r.pairings || []) {
          const asWhite = g.white_rank === p.rank;
          const asBlack = g.black_rank === p.rank;
          if (!asWhite && !asBlack) continue;
          const res = g.result; if (!res) continue;
          gm++; games++;
          const won = asWhite ? (res === "1" || res === "+") : (res === "0" || res === "-");
          const drew = res === "=";
          if (won) { pts += 1; wins++; } else if (drew) { pts += 0.5; draws++; } else { losses++; }
          const oppRank = asWhite ? g.black_rank : g.white_rank;
          if (oppRank) {
            const opp = t.players.find((x: any) => x.rank === oppRank);
            if (opp?.rating) { oppRatingSum += opp.rating; oppRatingCount++; }
          }
        }
      }
      events.push({ _id: t._id, name: t.name, city: t.city, start_date: t.start_date, points: pts, played: gm, of: (t.rounds?.length || 0), rank: p.rank });
    }
    if (!name) { res.status(404).send(notFoundHtml()); return; }
    const pointsPct = games ? ((wins + draws * 0.5) / games * 100).toFixed(1) : "0.0";
    const avgOpp = oppRatingCount ? Math.round(oppRatingSum / oppRatingCount) : "—";
    const title = `${name} (FIDE ${fideId}) — chess tournament results — ChessGuru`;
    const desc = `${name}: ${events.length} public tournaments · ${games} games · ${pointsPct}% score · avg opponent ${avgOpp}. Free crosstable + player search on ChessGuru Results.`;
    const url = `https://results.chessguru.cc/player/${fideId}`;
    const jsonLd = {
      "@context": "https://schema.org", "@type": "Person",
      name, identifier: fideId, url,
      description: `Chess player with FIDE ID ${fideId} — active in ${events.length} tournaments on ChessGuru Results.`,
    };
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="profile"><meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem; color: #1c1917; background: #fefbf6; }
  h1 { margin: 0.25rem 0; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0 2rem; }
  .stat { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 0.75rem 1rem; min-width: 100px; }
  .stat-v { font-size: 1.4rem; font-weight: 700; color: #7c3aed; }
  .stat-l { color: #78716c; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem 0.6rem; border-bottom: 1px solid #e7e5e4; text-align: left; }
  th { background: #f5f5f4; font-size: 0.75rem; text-transform: uppercase; }
  a { color: #7c3aed; }
</style></head>
<body>
<nav><a href="/">← All tournaments</a></nav>
<h1>${esc(name)}</h1>
<div style="color:#57534e;">FIDE ID ${esc(fideId)} · ${events.length} tournaments</div>
<div class="stats">
  <div class="stat"><div class="stat-v">${games}</div><div class="stat-l">games</div></div>
  <div class="stat"><div class="stat-v">${wins}/${draws}/${losses}</div><div class="stat-l">W/D/L</div></div>
  <div class="stat"><div class="stat-v">${pointsPct}%</div><div class="stat-l">score</div></div>
  <div class="stat"><div class="stat-v">${avgOpp}</div><div class="stat-l">avg opp</div></div>
</div>
<h2>Tournaments</h2>
<table><thead><tr><th>Date</th><th>Tournament</th><th>City</th><th>Rank</th><th>Score</th></tr></thead>
<tbody>
${events.map((e) => `<tr><td>${esc(e.start_date || "")}</td><td><a href="/t/${e._id}">${esc(e.name)}</a></td><td>${esc(e.city || "")}</td><td>${e.rank}</td><td>${e.points.toFixed(1)} / ${e.of}</td></tr>`).join("\n")}
</tbody></table>
</body></html>`;
    res.send(html);
  }

  /** SEO HTML for one federation — every public tournament from that fed. */
  @Get("render/results/federation/:code")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async federationHtml(@Param("code") code: string, @Res() res: any) {
    const fed = code.toUpperCase();
    const rows = await this.conn.db!.collection("sm_tournaments").find({ is_public: true, federation: fed }).sort({ start_date: -1 }).limit(200).toArray();
    if (rows.length === 0) { res.status(404).send(notFoundHtml()); return; }
    const totalPlayers = rows.reduce((s: number, t: any) => s + (t.players?.length || 0), 0);
    const totalRounds = rows.reduce((s: number, t: any) => s + (t.rounds?.length || 0), 0);
    const title = `Chess tournaments in ${fed} — ChessGuru Results`;
    const desc = `${rows.length} chess tournaments held under ${fed} federation — FIDE, AICF and state-rated events. Full crosstables, standings and round pairings.`;
    const url = `https://results.chessguru.cc/federation/${fed}`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 1rem; color: #1c1917; background: #fefbf6; }
  h1 { margin: 0.25rem 0; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0 2rem; }
  .stat { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; padding: 0.75rem 1rem; min-width: 120px; }
  .stat-v { font-size: 1.4rem; font-weight: 700; color: #7c3aed; }
  .stat-l { color: #78716c; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0.75rem; }
  .card { border: 1px solid #e7e5e4; border-radius: 12px; padding: 1rem; text-decoration: none; color: inherit; background: #fff; }
  .card:hover { border-color: #7c3aed; }
  a { color: #7c3aed; }
</style></head>
<body>
<nav><a href="/">← All tournaments</a></nav>
<h1>♟ Chess tournaments in ${esc(fed)}</h1>
<div class="stats">
  <div class="stat"><div class="stat-v">${rows.length}</div><div class="stat-l">tournaments</div></div>
  <div class="stat"><div class="stat-v">${totalPlayers}</div><div class="stat-l">player-events</div></div>
  <div class="stat"><div class="stat-v">${totalRounds}</div><div class="stat-l">rounds played</div></div>
</div>
<div class="grid">
${rows.map((t: any) => `<a class="card" href="/t/${t._id}"><div style="font-weight:600;">${esc(t.name)}</div><div style="color:#78716c;font-size:0.85rem;margin-top:0.25rem;">${esc(t.city || "")} · ${esc(t.rating_type)} · ${t.players?.length || 0} players · ${esc(t.start_date || "")}</div></a>`).join("\n")}
</div>
</body></html>`;
    res.send(html);
  }

  /** sitemap.xml — all public tournament URLs. Google Search Console picks
   *  this up automatically. Regenerated on every request; cheap because
   *  is_public tournaments are limited to a few thousand for years. */
  @Get("render/results/sitemap.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  async sitemap(@Res() res: any) {
    const rows = await this.conn.db!.collection("sm_tournaments").find({ is_public: true }, { projection: { _id: 1, updated_at: 1, federation: 1, players: 1 } as any }).limit(50000).toArray();
    const feds = new Set<string>();
    const fideIds = new Set<string>();
    for (const t of rows) {
      if (t.federation) feds.add(t.federation);
      for (const p of t.players || []) if (p.fide_id) fideIds.add(p.fide_id);
    }
    const now = new Date().toISOString();
    const urls = [
      { loc: "https://results.chessguru.cc/", lastmod: now },
      ...Array.from(feds).map((f) => ({ loc: `https://results.chessguru.cc/federation/${f}`, lastmod: now })),
      ...rows.map((t: any) => ({ loc: `https://results.chessguru.cc/t/${t._id}`, lastmod: t.updated_at })),
      ...Array.from(fideIds).map((f) => ({ loc: `https://results.chessguru.cc/player/${f}`, lastmod: now })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}
</urlset>`;
    res.send(xml);
  }
}

function notFoundHtml(): string {
  return `<!doctype html><html><head><title>Not found — ChessGuru Results</title></head>
<body style="font-family:system-ui;text-align:center;padding:4rem;">
<h1>♟ Tournament not found</h1>
<p><a href="/">← Back to all tournaments</a></p>
</body></html>`;
}

// Satori needs a font loaded from bytes; ship any TTF that has the Latin
// glyphs we need. Cache the font once at module scope — reading it every
// request is wasteful.
let cachedFont: Buffer | null = null;
async function loadFont(): Promise<Buffer> {
  if (cachedFont) return cachedFont;
  // Prefer the DejaVu Sans that Ubuntu ships everywhere; fall back to
  // Liberation Sans if it isn't present.
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const c of candidates) {
    try { cachedFont = await readFile(c); return cachedFont; } catch { /* try next */ }
  }
  throw new Error("no font available for OG rendering");
}

