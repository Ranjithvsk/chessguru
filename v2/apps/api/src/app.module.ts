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
import { AdminDomainsController } from "./admin/admin-domains.controller";
import { EngineController } from "./engine/engine.controller";
import { EngineService } from "./engine/engine.service";
import { ExplorerController } from "./explorer/explorer.controller";
import { ExplorerService } from "./explorer/explorer.service";
import { StudyController } from "./study/study.controller";
import { StudyService } from "./study/study.service";
import { StudiesController } from "./studies/studies.controller";
import { StudiesService } from "./studies/studies.service";
import { BooksController } from "./books/books.controller";
import { BooksService } from "./books/books.service";
import { RevisionsController } from "./revisions/revisions.controller";
import { RevisionsService } from "./revisions/revisions.service";
import { ExamsController } from "./exams/exams.controller";
import { ExamsService } from "./exams/exams.service";
import { MyGamesController } from "./my-games/my-games.controller";
import { MyGamesService } from "./my-games/my-games.service";
import { InsightsController } from "./insights/insights.controller";
import { InsightsService } from "./insights/insights.service";
import { CoachBoardController } from "./coach-board/coach-board.controller";
import { CoachBoardService } from "./coach-board/coach-board.service";
import { ParentReportsController } from "./parent-reports/parent-reports.controller";
import { ParentReportsService } from "./parent-reports/parent-reports.service";
import { ParentPortalController } from "./parent-portal/parent-portal.controller";
import { BookDiagramsController } from "./book-diagrams/book-diagrams.controller";
import { BookDiagramsService } from "./book-diagrams/book-diagrams.service";
import { ClassRecordingController } from "./class/class-recording.controller";
import { ClassScheduleController } from "./class/class-schedule.controller";
import { ClassAttendanceController } from "./class/class-attendance.controller";
import { ClassSnapController } from "./class/class-snap.controller";
import { ClassReminderService } from "./class/class-reminder.service";
import { ClassAbandonedSweepService } from "./class/class-abandoned-sweep.service";
import { SavedLinesController } from "./saved-lines/saved-lines.controller";
import { OpeningTrainerController } from "./opening-trainer/opening-trainer.controller";
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
import { PlayController } from "./play/play.controller";
import { ConnectController } from "./connect/connect.controller";
import { PairingsController } from "./pairings/pairings.controller";
import { ResultsController } from "./pairings/results.controller";
import { ResultsRenderController } from "./pairings/results-render.controller";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI), IntegrationsModule, LivekitModule, AcademyModule],
  controllers: [HealthController, MiscController, BroadcastsController, PuzzlesController, AuthController, AdminController, AdminDomainsController, EngineController, ExplorerController, StudyController, StudiesController, BooksController, RevisionsController, ExamsController, MyGamesController, InsightsController, CoachBoardController, ParentReportsController, ParentPortalController, BookDiagramsController, ClassRecordingController, ClassScheduleController, ClassAttendanceController, ClassSnapController, ClassOptOutController, MailWebhookController, IceConfigController, DigestOptOutController, EmailOptOutController, PushController, AnnouncementsController, VisionController, HomeworkController, ClassNotesController, MyClassNotesController, AcademyClassNotesController, ClassLiveController, MaterialsController, MyMaterialsController, MaterialsFileController, OpeningNotesController, CoachPublicController, MyCoachProfileController, AcademyPublicController, MyAcademyProfileController, SavedLinesController, OpeningTrainerController, PlayController, ConnectController, PairingsController, ResultsController, ResultsRenderController],
  providers: [PuzzlesService, AuthService, AdminService, EngineService, ExplorerService, StudyService, StudiesService, BooksService, RevisionsService, ExamsService, MyGamesService, InsightsService, CoachBoardService, ParentReportsService, BookDiagramsService, ClassReminderService, ClassAbandonedSweepService, WeeklyDigestService, StreakReminderService, PushService, AnnouncementsService, VisionService, HomeworkService, MaterialReminderService, OpeningNotesService, CoachProfileService, CoachDomainService, AcademyProfileService, AcademyDomainService],
})
export class AppModule {}
