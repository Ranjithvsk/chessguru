import { Module } from "@nestjs/common";
import { LichessLinkController } from "./lichess.controller";
import { ChesscomLinkController } from "./chesscom.controller";
import { MeLinksController } from "./me-links.controller";
import { GamesFetchService } from "./games-fetch.service";

@Module({
  controllers: [LichessLinkController, ChesscomLinkController, MeLinksController],
  providers: [GamesFetchService],
  exports: [GamesFetchService],
})
export class IntegrationsModule {}
