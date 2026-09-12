import { Body, Controller, Param, Get, Post, Req, UnauthorizedException, BadRequestException } from "@nestjs/common";
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
  async classifyBoard(@Req() req: any, @Body() body: ClassifyBoardBody) {
    // Scanning is a coach tool and it is expensive: ~2.6 core-seconds a call
    // on the box that also serves live classes. It used to take no auth at
    // all, so anyone could farm it -- and enough call/answer pairs are all
    // you need to distil a copy of our extractor without ever touching the
    // weights. Signed-in only, and rate limited in nginx besides.
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
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
  async classifyBoardV2(@Req() req: any, @Body() body: ClassifyBoardBody) {
    // Scanning is a coach tool and it is expensive: ~2.6 core-seconds a call
    // on the box that also serves live classes. It used to take no auth at
    // all, so anyone could farm it -- and enough call/answer pairs are all
    // you need to distil a copy of our extractor without ever touching the
    // weights. Signed-in only, and rate limited in nginx besides.
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.boardPngBase64) throw new BadRequestException("boardPngBase64 required");
    try {
      return await this.svc.classifyBoardV2(body.boardPngBase64);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Public: fire-and-forget endpoint the client calls IMMEDIATELY on any
   *  image upload -- so the raw input hits vision-log/ even when the coach
   *  never presses "Server AI" (client-side detection alone doesn't log).
   *  Body: { boardPngBase64, source } where source is a free-form tag
   *  ("upload", "camera", "paste", etc.). Response is trivial. */
  /** "Use this position" — the coach confirms the scan was right (feature 1). */
  @Post("scan/:id/accept")
  async acceptScan(@Req() req: any, @Param("id") id: string, @Body() body: { finalFen?: string; weakConfirmed?: number }) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    const ok = await this.svc.acceptScan(String(req.session.userId), id, body?.finalFen ?? null, typeof body?.weakConfirmed === "number" ? body.weakConfirmed : null);
    return { ok };
  }

  @Post("log-scan")
  async logScan(@Req() req: any, @Body() body: { boardPngBase64: string; source?: string }) {
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.boardPngBase64) throw new BadRequestException("boardPngBase64 required");
    try {
      await this.svc.logScanOnly(body.boardPngBase64, body.source || "upload");
      return { ok: true };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** v4 super-fast classifier: MobileNetV3-small (INT8) + chess-rules FEN
   *  legality repair. Target <200ms warm CPU inference, 98%+ accuracy on
   *  unfamiliar book fonts. Legal-only FEN output guaranteed via top-3
   *  beam-search repair pass. */
  @Post("classify-board-v4")
  async classifyBoardV4(@Req() req: any, @Body() body: ClassifyBoardBody) {
    // Scanning is a coach tool and it is expensive: ~2.6 core-seconds a call
    // on the box that also serves live classes. It used to take no auth at
    // all, so anyone could farm it -- and enough call/answer pairs are all
    // you need to distil a copy of our extractor without ever touching the
    // weights. Signed-in only, and rate limited in nginx besides.
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.boardPngBase64) throw new BadRequestException("boardPngBase64 required");
    try {
      return await this.svc.classifyBoardV4(body.boardPngBase64);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** "Ultra AI" — proxies to Python :5100 microservice (MIT YOLOv8n-seg
   *  extractor + 3-model classifier ensemble: YOLOv8n-cls + DINOv2-small
   *  + DINOv3-small with 4-rotation autopick + chess-rules validation).
   *  If warpedBoardPngBase64 is supplied, microservice skips its extractor
   *  and uses the client's tight OpenCV.js warp — needed for iPad/tablet
   *  screen photos where the server extractor picks up UI chrome. */
  @Post("classify-board-ultra")
  async classifyBoardUltra(
    @Req() req: any,
    @Body() body: { rawImagePngBase64: string; warpedBoardPngBase64?: string },
  ) {
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.rawImagePngBase64) throw new BadRequestException("rawImagePngBase64 required");
    try {
      const j = await this.svc.classifyBoardUltra(body.rawImagePngBase64, body.warpedBoardPngBase64);
      // One record per classified board, so "how many positions were scanned, and how many came
      // back correct" is a real number from today rather than a guess from image files on disk.
      // Corrections carry the id back (see recordCorrection), which is what turns "scanned" into
      // "edited" or "accepted as read". Best-effort: a logging failure must never fail a scan.
      const scanId = await this.svc.recordScan(String(req.session.userId), req.session?.academyId ?? null, "editor", j).catch(() => null);
      return scanId ? { ...j, scanId } : j;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Handwritten scoresheet reader. Coaches and owners only: the result is a
   *  game to be filed against a student, not a puzzle scan. Start returns a
   *  job id; status returns {state, pgn, cells[]} when done. */
  @Post("scoresheet/start")
  async scoresheetStart(
    @Req() req: any,
    @Body() body: { imagePngBase64: string; image2PngBase64?: string },
  ) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!["academy_owner", "coach"].includes(String(req.session?.role || ""))) throw new UnauthorizedException("coach or owner only");
    if (!body?.imagePngBase64) throw new BadRequestException("imagePngBase64 required");
    try {
      return await this.svc.scoresheetStart(body.imagePngBase64, body.image2PngBase64, String(req.session.userId));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Get("scoresheet/status/:jobId")
  async scoresheetStatus(@Req() req: any, @Param("jobId") jobId: string) {
    if (!req.session?.userId) throw new UnauthorizedException("login required");
    if (!/^[A-Za-z0-9-]{8,40}$/.test(jobId)) throw new BadRequestException("bad job id");
    try {
      return await this.svc.scoresheetStatus(jobId);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Server-side warp with user-drawn corners. Client sends raw image +
   *  4 corner coords (from CornerAdjuster); we proxy to the Python vision
   *  service which does the perspective warp via cv2 and returns a 512x512
   *  board PNG. Replaces the 10 MB opencv.js download that was killing
   *  mobile users on cellular. */
  @Post("warp-with-corners")
  async warpWithCorners(
    @Req() req: any,
    @Body() body: { rawImagePngBase64: string; corners: Array<{ x: number; y: number }> },
  ) {
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.rawImagePngBase64 || body?.corners?.length !== 4) {
      throw new BadRequestException("rawImagePngBase64 + 4 corners required");
    }
    try {
      return await this.svc.warpWithCorners(body.rawImagePngBase64, body.corners);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Save a user-adjusted set of 4 board corners (from the manual
   *  CornerAdjuster UI). Every save becomes a real ground-truth sample the
   *  nightly YOLO extractor retrain folds in — heavily weighted since it
   *  represents a user-verified corner set on a hard photo. */
  @Post("save-corner-labels")
  async saveCornerLabels(
    @Req() req: any,
    @Body() body: { rawImagePngBase64: string; corners: Array<{ x: number; y: number }>; sourceRef?: string },
  ) {
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.rawImagePngBase64 || body?.corners?.length !== 4) {
      throw new BadRequestException("rawImagePngBase64 + 4 corners required");
    }
    try {
      return await this.svc.saveCornerLabels(
        req.session?.userId ? String(req.session.userId) : null,
        body.rawImagePngBase64,
        body.corners,
        body.sourceRef,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** "ChessVision AI" fallback/oracle — proxies to chessvision.dev.
   *  Configured via env: CHESSVISION_API_URL, CHESSVISION_API_KEY,
   *  CHESSVISION_API_AUTH_HEADER (default X-Api-Key), CHESSVISION_API_BODY_FIELD
   *  (default image_base64). Meant to be shown SIDE-BY-SIDE with our own
   *  Ultra AI result so the user picks the correct one (both training
   *  signal AND ToS-compliant use of a paid oracle). */
  @Post("classify-board-chessvision")
  async classifyBoardChessVision(@Req() req: any, @Body() body: { rawImagePngBase64: string }) {
    if (!req.session?.userId) throw new UnauthorizedException("login required to scan");
    if (!body?.rawImagePngBase64) throw new BadRequestException("rawImagePngBase64 required");
    try {
      return await this.svc.classifyBoardChessVision(body.rawImagePngBase64);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
