// Coach-authored chess-diagram hotspots for the /book flip-through reader.
//
// Motivation: our vision extractor gets ~10-20% recall on multi-diagram book
// pages (Yusupov-style, 4-8 small boards per page). Instead of waiting for
// the vision model to catch up, coaches drag a rectangle around any diagram
// on the page → we crop that region → send to the vision service on the
// isolated crop (where it's ~95% accurate) → coach confirms/edits FEN → save.
//
// Result: 100% accurate hotspots, ~1 minute per page for a coach, unblocks
// every future book we add.
//
// One collection: `bookDiagrams`. bbox is [x%, y%, w%, h%] on the page
// image — same format the existing hard-coded PUZZLES map uses.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { randomBytes } from "crypto";
import { Chess } from "chess.js";

const MAX_LABEL = 200;
const VISION_URL = process.env.CHESSGURU_VISION_URL ?? "http://127.0.0.1:5100";

function shortId(bytes = 8): string { return randomBytes(bytes).toString("base64url"); }

export interface Diagram {
  _id: string;
  bookSlug: string;
  page: number;
  bbox: [number, number, number, number];   // x, y, w, h — percentages 0-100
  fen: string;
  side: "w" | "b";
  label?: string;
  createdByUserId: string;
  academyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BookDiagramsService {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  private col() { return this.conn.db!.collection<Diagram>("bookDiagrams"); }

  private ensureUser(session: any): { userId: string; academyId: string | null } {
    const userId = session?.userId;
    if (!userId) throw new UnauthorizedException("sign in first");
    return { userId: String(userId), academyId: session?.academyId ?? null };
  }

  /** Preview: send the crop to the vision service, return FEN + confidence.
   *  Doesn't persist — annotator gets to edit before saving. */
  async annotate(session: any, body: any) {
    this.ensureUser(session);
    const image_base64 = String(body?.imageBase64 || "").trim();
    if (!image_base64) throw new BadRequestException("imageBase64 required");
    // Strip data-URL prefix if present.
    const b64 = image_base64.replace(/^data:image\/[a-z]+;base64,/, "");
    let r: Response;
    try {
      r = await fetch(`${VISION_URL}/full`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: b64 }),
      });
    } catch (e: any) {
      throw new BadRequestException(`vision service unreachable: ${e?.message || e}`);
    }
    if (!r.ok) {
      let msg = `vision service HTTP ${r.status}`;
      try { const j: any = await r.json(); if (j?.detail) msg = String(j.detail); } catch { /* ignore */ }
      throw new BadRequestException(msg);
    }
    const j = (await r.json()) as any;
    // Validate FEN; if invalid, still return it (coach can fix).
    let side: "w" | "b" = "w";
    let fenIsValid = false;
    if (j.fen) {
      try {
        const c = new Chess(j.fen);
        side = c.turn() === "w" ? "w" : "b";
        fenIsValid = true;
      } catch { /* ignore */ }
    }
    return {
      ok: true,
      fen: j.fen || null,
      fenIsValid,
      side,
      warpQuality: j.warpQuality?.score ?? 0,
      boardPngBase64: j.boardPngBase64 || null,
      backend: j.backend,
    };
  }

  async list(session: any, bookSlug: string) {
    this.ensureUser(session);
    if (!bookSlug) throw new BadRequestException("bookSlug required");
    // For MVP: everyone-signed-in can see all diagrams for a book — they're
    // coach-authored public annotations, meant to be shared.
    const items = await this.col().find({ bookSlug }).sort({ page: 1, createdAt: 1 }).limit(500).toArray();
    return { items };
  }

  async create(session: any, body: any) {
    const { userId, academyId } = this.ensureUser(session);
    const b: any = body ?? {};
    const bookSlug = String(b.bookSlug || "").trim().slice(0, 60);
    const page = Number(b.page);
    const bbox = Array.isArray(b.bbox) && b.bbox.length === 4 ? b.bbox.map((n: any) => Math.max(0, Math.min(100, Number(n) || 0))) : null;
    const fen = String(b.fen || "").trim();
    if (!bookSlug || !Number.isInteger(page) || page < 1 || !bbox || !fen) {
      throw new BadRequestException("bookSlug + page + bbox + fen required");
    }
    // Validate FEN
    let side: "w" | "b" = "w";
    try { const c = new Chess(fen); side = c.turn() === "w" ? "w" : "b"; }
    catch { throw new BadRequestException("bad FEN"); }
    const label = b.label ? String(b.label).slice(0, MAX_LABEL) : undefined;
    const now = new Date();
    const _id = shortId(8);
    await this.col().insertOne({
      _id, bookSlug, page,
      bbox: bbox as [number, number, number, number],
      fen, side, label,
      createdByUserId: userId, academyId,
      createdAt: now, updatedAt: now,
    });
    return { diagramId: _id };
  }

  async update(session: any, id: string, body: any) {
    const { userId } = this.ensureUser(session);
    const cur = await this.col().findOne({ _id: id });
    if (!cur) throw new NotFoundException("no such diagram");
    if (cur.createdByUserId !== userId) throw new ForbiddenException("not your diagram");
    const set: any = { updatedAt: new Date() };
    if (typeof body?.fen === "string") {
      try { new Chess(body.fen); set.fen = body.fen.trim(); set.side = new Chess(body.fen).turn(); }
      catch { throw new BadRequestException("bad FEN"); }
    }
    if (typeof body?.label === "string") set.label = body.label.slice(0, MAX_LABEL);
    if (Array.isArray(body?.bbox) && body.bbox.length === 4) {
      set.bbox = body.bbox.map((n: any) => Math.max(0, Math.min(100, Number(n) || 0)));
    }
    await this.col().updateOne({ _id: id }, { $set: set });
    return { ok: true };
  }

  async remove(session: any, id: string) {
    const { userId } = this.ensureUser(session);
    const cur = await this.col().findOne({ _id: id });
    if (!cur) throw new NotFoundException("no such diagram");
    if (cur.createdByUserId !== userId) throw new ForbiddenException("not your diagram");
    await this.col().deleteOne({ _id: id });
    return { ok: true };
  }
}
