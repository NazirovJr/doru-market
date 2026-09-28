/** `ExportJobsRepositoryPort` — реализация поверх `export_jobs` (`db/schema/export-jobs.ts`, EP-15, DTJ-361). */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { exportJobs, type ExportJobRow } from '@/db/schema/export-jobs.js'
import type { ExportJobCreateCommand, ExportJobsRepositoryPort, ExportJobView } from '@/modules/admin/application/ports/report-export.port.js'

@Injectable()
export class DrizzleExportJobsRepository implements ExportJobsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async create(command: ExportJobCreateCommand): Promise<void> {
    await this.db.insert(exportJobs).values({
      id: command.id,
      reportType: command.reportType,
      params: command.params,
      format: command.format,
      status: 'processing',
      requestedBy: command.requestedBy,
      createdAt: command.createdAt,
    })
  }

  public async findById(id: string): Promise<ExportJobView | null> {
    const [row] = await this.db.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1)
    return row === undefined ? null : toView(row)
  }
}

function toView(row: ExportJobRow): ExportJobView {
  return { id: row.id, status: row.status, downloadUrl: row.downloadUrl }
}
