/**
 * `PgAuditLogAdapter` (DTJ-247) — реализация `AuditLogPort` (`escrow-reconciliation.job.ts`)
 * поверх `pg.Pool`, таблица `audit_log` (`migrations/0034_support_tickets_audit_log.sql`,
 * append-only на уровне роли БД — `REVOKE UPDATE, DELETE`, SRS-DB-024).
 *
 * `entity_type='escrow_ledger'`/`action='reconciliation_discrepancy_detected'` — единственная
 * точка, которую эта джоба пишет в `audit_log`; `reason` заполнен (буквальное требование
 * колонки для `category='ledger_adjustment'`, см. `db/schema`-комментарий в миграции).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { ESCROW_RECONCILIATION_DB_POOL } from './escrow-reconciliation.constants.js'
import type { AppendLedgerAdjustmentInput, AuditLogPort } from './escrow-reconciliation.job.js'

const AUDIT_ACTION = 'reconciliation_discrepancy_detected'
const AUDIT_REASON = 'EscrowReconciliationJob: escrow_ledger discrepancy detected (SRS-PAY-013)'

const COUNT_QUERY = `
  SELECT COUNT(*)::int AS count
  FROM audit_log
  WHERE category = 'ledger_adjustment' AND entity_type = 'escrow_ledger' AND entity_id = $1
`

const APPEND_QUERY = `
  INSERT INTO audit_log (category, entity_type, entity_id, action, reason, metadata, tenant_id)
  VALUES ('ledger_adjustment', 'escrow_ledger', $1, $2, $3, $4::jsonb, $5)
`

@Injectable()
export class PgAuditLogAdapter implements AuditLogPort {
  constructor(@Inject(ESCROW_RECONCILIATION_DB_POOL) private readonly pool: Pool) {}

  async countLedgerAdjustmentEntries(orderId: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>(COUNT_QUERY, [orderId])
    return result.rows[0]?.count ?? 0
  }

  async appendLedgerAdjustment(input: AppendLedgerAdjustmentInput): Promise<void> {
    const metadata = JSON.stringify({
      orderId: input.orderId,
      discrepancyDiram: input.discrepancyDiram.toString(),
      repeatDetectionCount: input.repeatDetectionCount,
    })
    await this.pool.query(APPEND_QUERY, [input.orderId, AUDIT_ACTION, AUDIT_REASON, metadata, input.tenantId])
  }
}
