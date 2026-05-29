import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HealthController } from "./health/health.controller";
import { MiscController } from "./misc.controller";
import { PuzzlesController } from "./puzzles/puzzles.controller";
import { PuzzlesService } from "./puzzles/puzzles.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { AdminController } from "./admin/admin.controller";
import { AdminService } from "./admin/admin.service";
import { EngineController } from "./engine/engine.controller";
import { EngineService } from "./engine/engine.service";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI)],
  controllers: [HealthController, MiscController, PuzzlesController, AuthController, AdminController, EngineController],
  providers: [PuzzlesService, AuthService, AdminService, EngineService],
})
export class AppModule {}
