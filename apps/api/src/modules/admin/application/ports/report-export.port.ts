// Хранение (MinIO, детерминированный ключ) целиком на стороне apps/worker — apps/api только читает уже сохранённый download_url, своего storage-порта не держит.
import type { ReportExportColumnDto, ReportExportFormat, ReportExportJobData } from '@dorutj/contracts'

export type ColumnDef = ReportExportColumnDto
export type { ReportExportJobData }

export const REPORT_EXPORT_RENDERER = Symbol.for('@dorutj/admin/report-export-renderer')

export interface ReportExportRendererPort {
  // "Sync" — синхронная ветка HTTP-ответа, не синхронность вызова (exceljs асинхронен).
  renderSync(rows: readonly Record<string, unknown>[], columns: readonly ColumnDef[], format: ReportExportFormat): Promise<Buffer>
}

export const REPORT_EXPORT_QUEUE = Symbol.for('@dorutj/admin/report-export-queue')

export interface ReportExportQueuePort {
  enqueue(job: ReportExportJobData): Promise<void>
}

export interface ExportJobCreateCommand {
  readonly id: string
  readonly reportType: string
  readonly params: Readonly<Record<string, unknown>>
  readonly format: ReportExportFormat
  readonly requestedBy: string | null
  readonly createdAt: Date
}

export interface ExportJobView {
  readonly id: string
  readonly status: 'processing' | 'ready' | 'failed'
  readonly downloadUrl: string | null
}

export const EXPORT_JOBS_REPOSITORY = Symbol.for('@dorutj/admin/export-jobs-repository')

export interface ExportJobsRepositoryPort {
  create(command: ExportJobCreateCommand): Promise<void>
  findById(id: string): Promise<ExportJobView | null>
}
