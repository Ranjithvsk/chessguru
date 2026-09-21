import { Module } from "@nestjs/common";
import { UltraDbController } from "./ultra-db.controller";

@Module({ controllers: [UltraDbController] })
export class UltraDbModule {}
