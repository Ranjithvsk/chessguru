import { Body, Controller, Get, Post, Req, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { VisionService, type FeedbackInput } from "./vision.service";

interface ClassifyBoardBody {
  boardPngBase64: string;   // required — 480x480 cropped board image (any resolution accepted, resized server-side)
}

@Controller("vision")
export class VisionController {
  constructor(private readonly svc: VisionService) {}

  /** Public: returns the current reference bank so the board detector
   *  can extend its template pool. Cache-Control is short (5 min) so a
   *  fresh correction is picked up on the next page load. */
  @Get("references")
  async references() {
    const rows = await this.svc.listApproved();
    return {
      references: rows.map((r) => ({
        piece: r.piece,
        color: r.color,
        setName: r.setName,
        source: r.source,
        silhouettePng: r.silhouettePng,
      })),
      count: rows.length,
    };
  }

  /** Auth: any logged-in user. Coach fixes a mis-classified square
   *  in the position editor -> client sends the ORIGINAL square crop
   *  (as a 40x40 grayscale silhouette PNG in base64) + the correct
   *  piece letter/colour. We store it as a new reference.
   *  If rawCropPng is also supplied, we run DINOv2 on it and store the
   *  embedding for the server-side classifier's reference bank. */
  @Post("feedback")
  async feedback(@Req() req: any, @Body() body: FeedbackInput) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!body?.piece || !body?.color || !body?.silhouettePng) {
      throw new BadRequestException("piece, color, silhouettePng required");
    }
    try {
      return await this.svc.recordCorrection(String(req.session.userId), body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Public: server-side board classifier ("Server AI" mode). Takes a
   *  cropped 480x480 board image (base64 PNG), splits it into 64 squares,
   *  embeds each via DINOv2, nearest-neighbour against the reference
   *  bank, returns FEN + per-square confidence.
   *
   *  Latency budget ~3-6s (CPU inference, 64 sequential embeds). Not
   *  session-guarded but rate-limited via body-size cap in main.ts. */
  @Post("classify-board")
  async classifyBoard(@Body() body: ClassifyBoardBody) {
    if (!body?.boardPngBase64) throw new BadRequestException("boardPngBase64 required");
    try {
      return await this.svc.classifyBoard(body.boardPngBase64);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** v3.5 direct chess-piece classifier (trained on Vinayaka RTX 3080).
   *  Same request shape as classify-board; response uses the same
   *  ClassifiedSquare structure so the client can consume either. */
  @Post("classify-board-v2")
  async classifyBoardV2(@Body() body: ClassifyBoardBody) {
    if (!body?.boardPngBase64) throw new BadRequestException("boardPngBase64 required");
    try {
      return await this.svc.classifyBoardV2(body.boardPngBase64);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
