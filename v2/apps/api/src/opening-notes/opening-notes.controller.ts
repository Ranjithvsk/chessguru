import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { OpeningNotesService } from "./opening-notes.service";

@Controller("openings")
export class OpeningNotesController {
  constructor(private readonly svc: OpeningNotesService) {}

  /** GET /api/openings/:slug/notes — all authored notes + pending request
   *  counts for one opening. Public (no auth) — students see notes without
   *  needing to be signed in. */
  @Get(":slug/notes")
  list(@Param("slug") slug: string) {
    return this.svc.listForOpening(slug);
  }

  /** POST /api/openings/:slug/notes/:ply — coach/owner authors a note.
   *  Body: { note: string } (markdown-lite, ≤ 5000 chars). */
  @Post(":slug/notes/:ply")
  upsert(@Req() req: any, @Param("slug") slug: string, @Param("ply") ply: string, @Body() body: any) {
    return this.svc.upsertNote(req.session, slug, Number(ply), String(body?.note || ""));
  }

  /** POST /api/openings/:slug/notes/:ply/request — student pings for an
   *  explanation. Idempotent per (user, slug, ply). */
  @Post(":slug/notes/:ply/request")
  requestNote(@Req() req: any, @Param("slug") slug: string, @Param("ply") ply: string) {
    return this.svc.requestNote(req.session, slug, Number(ply));
  }

  /** GET /api/openings/notes/pending — coach queue of outstanding explanation
   *  requests, ranked by request count (most-wanted first). */
  @Get("notes/pending")
  pending(@Req() req: any) {
    return this.svc.coachPending(req.session);
  }
}
