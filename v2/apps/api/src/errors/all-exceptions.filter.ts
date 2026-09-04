// Global catch-all that reports unhandled server faults to ErrorAlertsService.
// Extends Nest's BaseExceptionFilter and delegates to super.catch(), so the
// response body/status the client sees is byte-identical to before — this is
// purely an observation layer.
//
// Only >=500 is reported. 4xx (bad login, forbidden, not found) are normal
// traffic, not breakage, and would drown the signal.
import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ErrorAlertsService } from "./error-alerts.service";

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(applicationRef: any, private readonly alerts: ErrorAlertsService) {
    super(applicationRef);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === "http") {
      const status = exception instanceof HttpException ? exception.getStatus() : 500;
      if (status >= 500) {
        const req = host.switchToHttp().getRequest();
        this.alerts.report({
          kind: "server",
          status,
          message: (exception as any)?.message || String(exception),
          stack: (exception as any)?.stack,
          route: req?.originalUrl || req?.url,
          method: req?.method,
          userId: req?.session?.userId,
          academyId: req?.session?.academyId,
          userAgent: req?.headers?.["user-agent"],
          ip: req?.ip,
        });
      }
    }
    super.catch(exception, host);
  }
}
