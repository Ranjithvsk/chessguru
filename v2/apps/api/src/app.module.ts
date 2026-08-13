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
import { ClassSnapController } from "./class/class-snap.controller";
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
import { PushService } from "./push/push.service";
import { PushController } from "./push/push.controller";
import { AnnouncementsService } from "./announcements/announcements.service";
import { AnnouncementsController } from "./announcements/announcements.controller";
import { VisionService } from "./vision/vision.service";
import { VisionController } from "./vision/vision.controller";
import { HomeworkService } from "./homework/homework.service";
import { HomeworkController } from "./homework/homework.controller";
import { ClassNotesController, MyClassNotesController, AcademyClassNotesController } from "./class/class-notes.controller";
import { ClassLiveController } from "./class/class-live.controller";
import { MaterialsController, MyMaterialsController, MaterialsFileController } from "./materials/materials.controller";
import { MaterialReminderService } from "./materials/material-reminder.service";
import { OpeningNotesController } from "./opening-notes/opening-notes.controller";
import { OpeningNotesService } from "./opening-notes/opening-notes.service";
import { CoachPublicController, MyCoachProfileController } from "./coach-profile/coach-profile.controller";
import { CoachProfileService } from "./coach-profile/coach-profile.service";
import { CoachDomainService } from "./coach-profile/coach-domain.service";
import { AcademyPublicController, MyAcademyProfileController } from "./academy-profile/academy-profile.controller";
import { AcademyProfileService } from "./academy-profile/academy-profile.service";
import { AcademyDomainService } from "./academy-profile/academy-domain.service";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI), IntegrationsModule, LivekitModule, AcademyModule],
  controllers: [HealthController, MiscController, BroadcastsController, PuzzlesController, AuthController, AdminController, EngineController, ExplorerController, StudyController, ClassRecordingController, ClassScheduleController, ClassAttendanceController, ClassSnapController, ClassOptOutController, MailWebhookController, IceConfigController, DigestOptOutController, EmailOptOutController, PushController, AnnouncementsController, VisionController, HomeworkController, ClassNotesController, MyClassNotesController, AcademyClassNotesController, ClassLiveController, MaterialsController, MyMaterialsController, MaterialsFileController, OpeningNotesController, CoachPublicController, MyCoachProfileController, AcademyPublicController, MyAcademyProfileController],
  providers: [PuzzlesService, AuthService, AdminService, EngineService, ExplorerService, StudyService, ClassReminderService, WeeklyDigestService, StreakReminderService, PushService, AnnouncementsService, VisionService, HomeworkService, MaterialReminderService, OpeningNotesService, CoachProfileService, CoachDomainService, AcademyProfileService, AcademyDomainService],
})
export class AppModule {}
