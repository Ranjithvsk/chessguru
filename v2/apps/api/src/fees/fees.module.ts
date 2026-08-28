// Fees module — see PROJECT_MASTER/plans/CHESSGURU-FEES-MVP.md for the full plan.
// W1 exposes program + head CRUD only.

import { Module, OnModuleInit } from "@nestjs/common";
import { FeesController } from "./fees.controller";
import { FeesService } from "./fees.service";

@Module({
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule implements OnModuleInit {
  constructor(private readonly svc: FeesService) {}

  async onModuleInit() {
    // Runs once per api process boot. Idempotent — createIndex is a no-op after the
    // first successful call, so we don't need a separate migration.
    await this.svc.ensureIndices();
  }
}
