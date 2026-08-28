// Fees HTTP surface — W1 + W2.
//   W1 · programs / heads
//     POST   /api/fees/programs         create (optionally with heads)
//     GET    /api/fees/programs         list, filterable by status + q
//     GET    /api/fees/programs/:id     single program with heads
//     POST   /api/fees/programs/:id/archive   soft-delete
//   W2 · plans + enrollments
//     PUT    /api/fees/programs/:id/plan       upsert plan (1:1 with program)
//     GET    /api/fees/programs/:id/plan       returns null if never set
//     POST   /api/fees/enrollments             bulk enroll students in a plan
//     GET    /api/fees/enrollments             list, filter by plan/student/status
//     POST   /api/fees/enrollments/:id/pause   status → PAUSED
//     POST   /api/fees/enrollments/:id/resume  status → ACTIVE
//     POST   /api/fees/enrollments/:id/end     status → ENDED (soft delete)
//     GET    /api/fees/plans/:id/students-for-enroll   picker rows tagged with already-enrolled
//
// Auth: same session-cookie model every ChessGuru controller uses.
// Every write goes through FeesService which enforces academyId scoping.

import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
// NestJS-on-Express: `res` is an express Response. We type it loosely as `any`
// to avoid a compile-time dep on @types/express (not directly installed in this
// workspace; the transitive types don't get picked up cleanly by tsc).
import { FeesService } from "./fees.service";
import {
  BulkEnrollInput,
  CreateProgramInput,
  EnrollmentStatus,
  GenerateInvoicesInput,
  InvoiceStatus,
  RecordManualPaymentInput,
  UpsertPlanInput,
  WaiveInvoiceInput,
} from "./fees.types";

@Controller("fees")
export class FeesController {
  constructor(private readonly svc: FeesService) {}

  // ---- programs ------------------------------------------------------------

  @Post("programs")
  async createProgram(@Req() req: any, @Body() body: CreateProgramInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.createProgram(req.session, body);
  }

  @Get("programs")
  async listPrograms(@Req() req: any, @Query("status") status?: string, @Query("q") q?: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return { programs: await this.svc.listPrograms(req.session, { status, q }) };
  }

  @Get("programs/:id")
  async getProgram(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.getProgram(req.session, id);
  }

  @Post("programs/:id/archive")
  async archiveProgram(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.archiveProgram(req.session, id);
  }

  // ---- plans (1:1 with program) -------------------------------------------

  @Put("programs/:id/plan")
  async upsertPlan(@Req() req: any, @Param("id") programId: string, @Body() body: UpsertPlanInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.upsertPlan(req.session, programId, body);
  }

  @Get("programs/:id/plan")
  async getPlan(@Req() req: any, @Param("id") programId: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return { plan: await this.svc.getPlan(req.session, programId) };
  }

  // ---- enrollments --------------------------------------------------------

  @Post("enrollments")
  async bulkEnroll(@Req() req: any, @Body() body: BulkEnrollInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.bulkEnroll(req.session, body);
  }

  @Get("enrollments")
  async listEnrollments(
    @Req() req: any,
    @Query("planId") planId?: string,
    @Query("studentUserId") studentUserId?: string,
    @Query("status") status?: string,
  ) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const s = (status === "ACTIVE" || status === "PAUSED" || status === "ENDED") ? (status as EnrollmentStatus) : undefined;
    return { enrollments: await this.svc.listEnrollments(req.session, { planId, studentUserId, status: s }) };
  }

  @Post("enrollments/:id/pause")
  async pauseEnrollment(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.setEnrollmentStatus(req.session, id, "PAUSED");
  }

  @Post("enrollments/:id/resume")
  async resumeEnrollment(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.setEnrollmentStatus(req.session, id, "ACTIVE");
  }

  @Post("enrollments/:id/end")
  async endEnrollment(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.setEnrollmentStatus(req.session, id, "ENDED");
  }

  // ---- students-for-enroll picker ----------------------------------------

  @Get("plans/:id/students-for-enroll")
  async studentsForEnroll(@Req() req: any, @Param("id") planId: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return { students: await this.svc.listStudentsForEnroll(req.session, planId) };
  }

  // ---- invoices -----------------------------------------------------------

  @Post("invoices/generate")
  async generateInvoices(@Req() req: any, @Body() body: GenerateInvoicesInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.generateInvoices(req.session, body);
  }

  @Get("invoices")
  async listInvoices(
    @Req() req: any,
    @Query("status") status?: string,
    @Query("planId") planId?: string,
    @Query("programId") programId?: string,
    @Query("guardianUserId") guardianUserId?: string,
    @Query("overdueOnly") overdueOnly?: string,
  ) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const s: InvoiceStatus | undefined =
      status === "DRAFT" || status === "SENT" || status === "PARTIAL" || status === "PAID" || status === "OVERDUE" || status === "WAIVED" || status === "CANCELLED"
        ? (status as InvoiceStatus)
        : undefined;
    return {
      invoices: await this.svc.listInvoices(req.session, {
        status: s, planId, programId, guardianUserId,
        overdueOnly: overdueOnly === "1" || overdueOnly === "true",
      }),
    };
  }

  @Get("invoices/:id")
  async getInvoice(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.getInvoice(req.session, id);
  }

  @Post("invoices/:id/waive")
  async waiveInvoice(@Req() req: any, @Param("id") id: string, @Body() body: WaiveInvoiceInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.waiveInvoice(req.session, id, body);
  }

  @Post("invoices/:id/cancel")
  async cancelInvoice(@Req() req: any, @Param("id") id: string) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.cancelInvoice(req.session, id);
  }

  // ---- payments (manual) --------------------------------------------------

  @Post("payments/manual")
  async recordManualPayment(@Req() req: any, @Body() body: RecordManualPaymentInput) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    return this.svc.recordManualPayment(req.session, body);
  }

  // ---- PDFs ---------------------------------------------------------------

  @Get("invoices/:id/pdf")
  async invoicePdf(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const { buffer, filename } = await this.svc.renderInvoicePdf(req.session, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(buffer);
  }

  @Get("payments/:id/receipt.pdf")
  async receiptPdf(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    if (!req?.session?.userId) throw new UnauthorizedException();
    const { buffer, filename } = await this.svc.renderReceiptPdf(req.session, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.end(buffer);
  }
}
