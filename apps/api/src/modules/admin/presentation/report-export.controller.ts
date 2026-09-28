// Res() без passthrough — сырой бинарный CSV/XLSX в обход глобального ResponseInterceptor; async-ветка (202) строит конверт вручную тем же методом.
import { Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { ok, type ExportJobStatusDto, type ReportExportFormat, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { RequestReportExportUseCase } from '../application/use-cases/request-report-export.use-case.js'
import { GetExportJobStatusUseCase } from '../application/use-cases/get-export-job-status.use-case.js'
import { ReportExportRequest, type ReportExportRequestParams } from './report-export-request.decorator.js'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_ACCEPTED = 202

const CONTENT_TYPES: Readonly<Record<ReportExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

@Controller({ path: 'reports', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin', 'pharmacy_admin')
export class ReportExportController {
  public constructor(
    @Inject(RequestReportExportUseCase) private readonly requestReportExportUseCase: RequestReportExportUseCase,
    @Inject(GetExportJobStatusUseCase) private readonly getExportJobStatusUseCase: GetExportJobStatusUseCase,
  ) {}

  @Post(':reportType/export')
  @HttpCode(HTTP_STATUS_OK)
  public async requestExport(
    @ReportExportRequest() request: ReportExportRequestParams,
    @CurrentUser() claims: JwtClaims,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { reportType, format, body } = request
    const result = await this.requestReportExportUseCase.execute({
      reportType,
      format,
      periodDays: body.periodDays,
      params: body.params,
      actorUserId: claims.sub,
      ...(body.rows !== undefined && { rows: body.rows }),
      ...(body.columns !== undefined && { columns: body.columns }),
    })
    if (result.kind === 'sync') {
      reply.header('content-type', CONTENT_TYPES[format])
      reply.header('content-disposition', `attachment; filename="${reportType}.${format}"`)
      reply.send(result.buffer)
      return
    }
    reply.status(HTTP_STATUS_ACCEPTED)
    reply.send(ok({ exportJobId: result.exportJobId }))
  }

  @Get('export-jobs/:exportJobId')
  public async getExportJobStatus(@Param('exportJobId') exportJobId: string): Promise<SuccessEnvelope<ExportJobStatusDto>> {
    const job = await this.getExportJobStatusUseCase.execute({ exportJobId })
    return ok({ status: job.status, ...(job.downloadUrl !== null && { downloadUrl: job.downloadUrl }) })
  }
}
