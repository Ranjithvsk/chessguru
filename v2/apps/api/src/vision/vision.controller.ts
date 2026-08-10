import { Body, Controller, Get, Post, Req, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { VisionService, type FeedbackInput } from "./vision.service";

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
   *  piece letter/colour. We store it as a new reference. */
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
}
