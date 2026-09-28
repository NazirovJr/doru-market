import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { REPORT_EXPORT_DB_POOL } from './report-export.constants.js'
import type { ReportExportStorePort } from './report-export-store.port.js'

const MARK_READY_QUERY = `UPDATE export_jobs SET status = 'ready', download_url = $2, completed_at = $3 WHERE id = $1`
const MARK_FAILED_QUERY = `UPDATE export_jobs SET status = 'failed', completed_at = $2 WHERE id = $1`

@Injectable()
export class PgReportExportStoreAdapter implements ReportExportStorePort {
  public constructor(@Inject(REPORT_EXPORT_DB_POOL) private readonly pool: Pool) {}

  public async markReady(exportJobId: string, downloadUrl: string, completedAt: Date): Promise<void> {
    await this.pool.query(MARK_READY_QUERY, [exportJobId, downloadUrl, completedAt])
  }

  public async markFailed(exportJobId: string, completedAt: Date): Promise<void> {
    await this.pool.query(MARK_FAILED_QUERY, [exportJobId, completedAt])
  }
}
