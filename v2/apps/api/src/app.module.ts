import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HealthController } from "./health/health.controller";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/chessguru";

@Module({
  imports: [MongooseModule.forRoot(MONGO_URI)],
  controllers: [HealthController],
})
export class AppModule {}
