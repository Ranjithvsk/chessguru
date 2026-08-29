// Fees module — see PROJECT_MASTER/plans/CHESSGURU-FEES-MVP.md for the full plan.
// W1 exposes program + head CRUD; the module grew through W2 (invoices +
// payments + PDFs) and W3-lite (dashboard + reminder cron).

import { Module, OnModuleInit } from "@nestjs/common";
import { FeesController } from "./fees.controller";
import { FeesService } from "./fees.service";
import { FeesReminderCron } from "./fees.reminder-cron.service";
import { FeesPortalController, FeesWebhookController } from "./fees.portal.controller";
import { FeesPortalService } from "./fees.portal.service";

@Module({
  controllers: [FeesController, FeesPortalController, FeesWebhookController],
  providers: [FeesService, FeesReminderCron, FeesPortalService],
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
