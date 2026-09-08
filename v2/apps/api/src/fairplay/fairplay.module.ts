import { Global, Module } from "@nestjs/common";
import { FairplayService } from "./fairplay.service";

/** Global so PuzzlesService (AppModule) and AcademyService (AcademyModule)
 *  share ONE instance — the hold cache must be the same map for both. */
@Global()
@Module({ providers: [FairplayService], exports: [FairplayService] })
export class FairplayModule {}
