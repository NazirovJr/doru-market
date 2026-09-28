// Загрузка по детерминированному ключу + markReady ПОСЛЕ неё — падение между ними оставляет job processing, ретрай перезаписывает файл и завершает UPDATE идемпотентно (AC3).
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { buildReportExportObjectKey, renderCsvRows, type ReportExportJobData } from '@dorutj/contracts'
import { REPORT_EXPORT_DATA_BUILDER, REPORT_EXPORT_STORE } from './report-export.constants.js'
import type { ReportExportDataBuilderPort } from './report-export-data-builder.port.js'
import type { ReportExportStorePort } from './report-export-store.port.js'

export const REPORT_EXPORT_LOCAL_DIR = join(tmpdir(), 'dorutj-report-exports')

@Injectable()
export class GenerateReportExportJob {
  private readonly logger = new Logger(GenerateReportExportJob.name)

  public constructor(
    @Inject(REPORT_EXPORT_DATA_BUILDER) private readonly dataBuilder: ReportExportDataBuilderPort,
    @Inject(REPORT_EXPORT_STORE) private readonly store: ReportExportStorePort,
  ) {}

  public async process(job: Job<ReportExportJobData>): Promise<void> {
    const { exportJobId, reportType, params, format } = job.data
    try {
      const buffer = await this.renderReport(reportType, params, format)
      const key = buildReportExportObjectKey(exportJobId, format)
      await this.uploadLocal(key, buffer)
      await this.store.markReady(exportJobId, `file://${join(REPORT_EXPORT_LOCAL_DIR, key)}`, new Date())
    } catch (error) {
      this.logger.error(`report-export: job ${exportJobId} failed — ${error instanceof Error ? error.message : String(error)}`)
      await this.store.markFailed(exportJobId, new Date())
      throw error
    }
  }

  private async renderReport(reportType: string, params: Readonly<Record<string, unknown>>, format: ReportExportJobData['format']): Promise<Buffer> {
    if (format === 'xlsx') {
      throw new Error('report-export: асинхронный xlsx не реализован в apps/worker (exceljs — НУЖНАЯ ЗАВИСИМОСТЬ, см. отчёт DTJ-361)')
    }
    const { rows, columns } = await this.dataBuilder.build(reportType, params)
    return Buffer.from(renderCsvRows(rows, columns), 'utf-8')
  }

  private async uploadLocal(key: string, buffer: Buffer): Promise<void> {
    const fullPath = join(REPORT_EXPORT_LOCAL_DIR, key)
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, buffer)
  }
}
