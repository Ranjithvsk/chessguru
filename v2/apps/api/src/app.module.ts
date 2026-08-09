import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HealthController } from "./health/health.controller";
import { MiscController } from "./misc.controller";
import { BroadcastsController } from "./broadcasts.controller";
import { PuzzlesController } from "./puzzles/puzzles.controller";
import { PuzzlesService } from "./puzzles/puzzles.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";
import { EngineController } from "./engine/engine.controller";
import { EngineService } from "./engine/engine.service";
import { ExplorerController } from "./explorer/explorer.controller";
import { ExplorerService } from "./explorer/explorer.service";
import { StudyController } from "./study/study.controller";
import { StudyService } from "./study/study.service";
import { ClassRecordingController } from "./class/class-recording.controller";
import { ClassScheduleController } from "./class/class-schedule.controller";
import { ClassAttendanceController } from "./class/class-attendance.controller";
import { ClassReminderService } from "./class/class-reminder.service";
import { ClassOptOutController } from "./class/class-optout";
import { MailWebhookController } from "./class/mail-webhook.controller";
import { IntegrationsModule } from "./integrations/integrations.module";
import { LivekitModule } from "./livekit/livekit.module";
import { AcademyModule } from "./academy/academy.module";
import { IceConfigController } from "./video/ice-config.controller";
import { WeeklyDigestService } from "./digest/weekly-digest.service";
import { DigestOptOutController } from "./digest/digest-optout.controller";
import { EmailOptOutController } from "./digest/email-optout.controller";
import { StreakReminderService } from "./digest/streak-reminder.service";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI), IntegrationsModule, LivekitModule, AcademyModule],
  controllers: [HealthController, MiscController, BroadcastsController, PuzzlesController, AuthController, AdminController, EngineController, ExplorerController, StudyController, ClassRecordingController, ClassScheduleController, ClassAttendanceController, ClassOptOutController, MailWebhookController, IceConfigController, DigestOptOutController, EmailOptOutController],
  providers: [PuzzlesService, AuthService, AdminService, EngineService, ExplorerService, StudyService, ClassReminderService, WeeklyDigestService, StreakReminderService],
})
export class AppModule {}
