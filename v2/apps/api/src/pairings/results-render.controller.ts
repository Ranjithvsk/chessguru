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
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(t.name)}">
<meta name="twitter:description" content="${esc(desc)}">
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

  /** sitemap.xml — all public tournament URLs. Google Search Console picks
   *  this up automatically. Regenerated on every request; cheap because
   *  is_public tournaments are limited to a few thousand for years. */
  @Get("render/results/sitemap.xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=3600")
  async sitemap(@Res() res: any) {
    const rows = await this.conn.db!.collection("sm_tournaments").find({ is_public: true }, { projection: { _id: 1, updated_at: 1 } as any }).limit(50000).toArray();
    const urls = [
      { loc: "https://results.chessguru.cc/", lastmod: new Date().toISOString() },
      ...rows.map((t: any) => ({ loc: `https://results.chessguru.cc/t/${t._id}`, lastmod: t.updated_at })),
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
