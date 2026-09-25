import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { AUDIT_LOG_RETENTION_DB_POOL } from './audit-log-retention.constants.js'
import type { AuditLogRetentionCriteria, AuditLogRetentionPort } from './audit-log-retention.port.js'

// LIMIT в подзапросе — батч ограниченного размера, не единый DELETE по всей таблице.
// ORDER BY id — детерминированный порядок батчей.
const DELETE_BATCH_SQL = `
  DELETE FROM audit_log
  WHERE id IN (
    SELECT id FROM audit_log
    WHERE category != $1 AND created_at < $2
    ORDER BY id
    LIMIT $3
  )
`

@Injectable()
export class PgAuditLogRetentionAdapter implements AuditLogRetentionPort {
  constructor(@Inject(AUDIT_LOG_RETENTION_DB_POOL) private readonly pool: Pool) {}

  async deleteBatch(criteria: AuditLogRetentionCriteria): Promise<number> {
    const result = await this.pool.query(DELETE_BATCH_SQL, [criteria.excludedCategory, criteria.cutoff, criteria.batchSize])
    return result.rowCount ?? 0
  }
}
