// renderCsvRows — общий для apps/api и apps/worker (отдельные TS-проекты); возвращает string, не Buffer (пакет собирается и для браузера).
import { z } from 'zod'

export const REPORT_EXPORT_FORMATS = ['csv', 'xlsx'] as const
export const reportExportFormatSchema = z.enum(REPORT_EXPORT_FORMATS)
export type ReportExportFormat = z.infer<typeof reportExportFormatSchema>

export const EXPORT_JOB_STATUSES = ['processing', 'ready', 'failed'] as const
export const exportJobStatusSchema = z.enum(EXPORT_JOB_STATUSES)
export type ExportJobStatus = z.infer<typeof exportJobStatusSchema>

export const SYNC_EXPORT_MAX_PERIOD_DAYS = 31

export function isSyncExportPeriod(periodDays: number): boolean {
  return periodDays <= SYNC_EXPORT_MAX_PERIOD_DAYS
}

export const reportExportColumnSchema = z.object({
  key: z.string().min(1),
  header: z.string().min(1),
})
export type ReportExportColumnDto = z.infer<typeof reportExportColumnSchema>

// rows/columns — только синхронная ветка (уже загружены клиентом); params — обе ветки.
export const requestReportExportBodySchema = z.object({
  periodDays: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).default({}),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  columns: z.array(reportExportColumnSchema).optional(),
})
export type RequestReportExportBodyDto = z.infer<typeof requestReportExportBodySchema>

export interface ExportJobAcceptedDto {
  readonly exportJobId: string
}

export interface ReportExportJobData {
  readonly exportJobId: string
  readonly reportType: string
  readonly params: Readonly<Record<string, unknown>>
  readonly format: ReportExportFormat
}

export interface ExportJobStatusDto {
  readonly status: ExportJobStatus
  readonly downloadUrl?: string
}

const CSV_SPECIAL_CHARS = /["\n,]/

function escapeCsvField(value: unknown): string {
  const raw = stringifyCsvValue(value)
  if (!CSV_SPECIAL_CHARS.test(raw)) {
    return raw
  }
  return `"${raw.replace(/"/g, '""')}"`
}

function stringifyCsvValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return ''
    case 'string':
      return value
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString()
    case 'object':
      return value === null ? '' : JSON.stringify(value)
    default:
      return JSON.stringify(value)
  }
}

export function renderCsvRows(rows: readonly Record<string, unknown>[], columns: readonly ReportExportColumnDto[]): string {
  const headerLine = columns.map((column) => escapeCsvField(column.header)).join(',')
  const dataLines = rows.map((row) => columns.map((column) => escapeCsvField(row[column.key])).join(','))
  return [headerLine, ...dataLines].join('\r\n')
}

const REPORT_EXPORT_STORAGE_BUCKET_PREFIX = 'report-exports'

// Детерминированный ключ объекта — без Date.now()/Math.random(), повторный запуск джобы перезаписывает тот же объект.
export function buildReportExportObjectKey(exportJobId: string, format: ReportExportFormat): string {
  return `${REPORT_EXPORT_STORAGE_BUCKET_PREFIX}/${exportJobId}.${format}`
}
