// Central sink for "something broke for a user" events: server 500s, browser
// crashes, slow requests. The actual write-to-`errorEvents` + throttled-email
// logic now lives in the DI-free ErrorReporter, so the standalone class-ws
// (:4100) process can reuse it verbatim to report realtime board-sync +
// video-signal failures. This class is just the Nest wrapper the API's
// exception filter / controllers inject.
import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ErrorReporter, type ErrorReport } from "./error-reporter";

// Re-export so any existing type importers keep resolving.
export type { ErrorKind, ErrorReport } from "./error-reporter";

@Injectable()
export class ErrorAlertsService implements OnModuleInit {
  private readonly reporter: ErrorReporter;

  constructor(@InjectConnection() conn: Connection) {
    this.reporter = new ErrorReporter(conn);
  }

  async onModuleInit() {
    await this.reporter.ensureIndexes();
  }

  /** Fire-and-forget: callers are error paths and must not be able to throw. */
  report(ev: ErrorReport): void {
    this.reporter.report(ev);
  }
}
