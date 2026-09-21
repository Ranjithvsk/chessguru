import { Module } from "@nestjs/common";
import { LiveBroadcastController } from "./live-broadcast.controller";
import { LiveBroadcastService } from "./live-broadcast.service";

@Module({ controllers: [LiveBroadcastController], providers: [LiveBroadcastService] })
export class LiveBroadcastModule {}
