// Объединяет reportType/format/body в один параметр — иначе контроллер нёс бы 5, max-params ≤3.
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { reportExportFormatSchema, requestReportExportBodySchema, ValidationError, type ReportExportFormat, type RequestReportExportBodyDto } from '@dorutj/contracts'

export interface ReportExportRequestParams {
  readonly reportType: string
  readonly format: ReportExportFormat
  readonly body: RequestReportExportBodyDto
}

interface RawReportExportRequest {
  readonly params: Record<string, string | undefined>
  readonly query: Record<string, string | string[] | undefined>
  readonly body: unknown
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseFormat(raw: string | undefined): ReportExportFormat {
  const result = reportExportFormatSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(`Неизвестный формат экспорта: ${raw ?? '(не указан)'}`, { format: raw })
  }
  return result.data
}

export const ReportExportRequest = createParamDecorator((_data: unknown, ctx: ExecutionContext): ReportExportRequestParams => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>() as unknown as RawReportExportRequest
  const reportType = request.params.reportType
  if (reportType === undefined) {
    throw new ValidationError('missing required path parameter "reportType"')
  }
  const bodyResult = requestReportExportBodySchema.safeParse(request.body)
  if (!bodyResult.success) {
    throw new ValidationError('Некорректное тело запроса экспорта отчёта', { issues: bodyResult.error.issues })
  }
  return { reportType, format: parseFormat(firstValue(request.query.format)), body: bodyResult.data }
})
