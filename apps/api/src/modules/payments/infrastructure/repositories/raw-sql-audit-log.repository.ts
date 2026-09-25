/**
 * `RawSqlAuditLogRepository` (EP-10, DTJ-243) — реализация `AuditLogPort` поверх `audit_log`
 * (append-only на уровне привилегий роли БД, `REVOKE UPDATE, DELETE`, миграция
 * `0034_support_tickets_audit_log.sql`) через СЫРОЙ `db.execute(sql\`...\`)` — см. DISPUTED в
 * JSDoc порта/`raw-sql-support-ticket.repository.ts` про причину (не типизированный `pgTable`,
 * `audit_log` — `files_owned` DTJ-270, параллельная разработка).
 *
 * `category='payment_override'` — ЗАФИКСИРОВАНО буквальным текстом DTJ-243 «Что сделать» п.1
 * для случая «неизвестный платёж».
 *
 * `entity_id` (см. JSDoc порта): `input.entityId ?? randomUUID()` — минтит суррогатный id, КОГДА
 * реальной сущности (заказа) нет (`audit_log.entity_id UUID NOT NULL`). `entity_type` в этом
 * случае — `'payment_webhook_event'`, отличимо от `'order'`-записей.
 */
import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import {
  AUDIT_LOG_PORT,
  type AppendPaymentOverrideAuditInput,
  type AuditLogPort,
  type FindReconciliationAlertsInput,
  type FindReconciliationAlertsResult,
  type ReconciliationAlertRow,
} from '@/modules/payments/application/ports/audit-log.port.js'

const PAYMENT_OVERRIDE_CATEGORY = 'payment_override'
const ORDER_ENTITY_TYPE = 'order'
const WEBHOOK_EVENT_ENTITY_TYPE = 'payment_webhook_event'
const LEDGER_ADJUSTMENT_CATEGORY = 'ledger_adjustment'
const ESCROW_LEDGER_ENTITY_TYPE = 'escrow_ledger'

interface ReconciliationAlertSqlRow {
  readonly order_id: string
  readonly tenant_id: string | null
  readonly metadata: { readonly discrepancyDiram?: string; readonly repeatDetectionCount?: number }
  readonly created_at: Date
  readonly id: string
}

@Injectable()
export class RawSqlAuditLogRepository implements AuditLogPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async appendPaymentOverride(input: AppendPaymentOverrideAuditInput): Promise<void> {
    const entityId = input.entityId ?? randomUUID()
    const entityType = input.entityId === null ? WEBHOOK_EVENT_ENTITY_TYPE : ORDER_ENTITY_TYPE
    await this.db.execute(sql`
      INSERT INTO audit_log (category, entity_type, entity_id, action, metadata, tenant_id, reason, actor_user_id)
      VALUES (
        ${PAYMENT_OVERRIDE_CATEGORY}, ${entityType}, ${entityId}, ${input.action},
        ${JSON.stringify(input.metadata)}::jsonb, ${input.tenantId}, ${input.reason ?? null}, ${input.actorUserId ?? null}
      )
    `)
  }

  /** ДОБАВЛЕНО (DTJ-357) — см. JSDoc порта. `DISTINCT ON` берёт ПОСЛЕДНЮЮ (по `created_at`) запись на заказ. */
  public async findLedgerAdjustmentAlerts(input: FindReconciliationAlertsInput): Promise<FindReconciliationAlertsResult> {
    const cursorCondition =
      input.cursor === null
        ? sql``
        : sql`WHERE created_at < ${new Date(input.cursor.v)} OR (created_at = ${new Date(input.cursor.v)} AND id < ${input.cursor.id})`
    const result = await this.db.execute(sql`
      SELECT order_id, tenant_id, metadata, created_at, id FROM (
        SELECT DISTINCT ON (entity_id) entity_id AS order_id, tenant_id, metadata, created_at, id
        FROM audit_log
        WHERE category = ${LEDGER_ADJUSTMENT_CATEGORY} AND entity_type = ${ESCROW_LEDGER_ENTITY_TYPE}
        ORDER BY entity_id, created_at DESC, id DESC
      ) latest
      ${cursorCondition}
      ORDER BY created_at DESC, id DESC
      LIMIT ${input.limit + 1}
    `)
    const rows = extractRows(result)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toAlertRow),
      nextCursor: hasMore && last !== undefined ? { v: last.created_at.toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

function extractRows(result: unknown): readonly ReconciliationAlertSqlRow[] {
  if (Array.isArray(result)) {
    return result as ReconciliationAlertSqlRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as ReconciliationAlertSqlRow[]
    }
  }
  return []
}

function toAlertRow(row: ReconciliationAlertSqlRow): ReconciliationAlertRow {
  return {
    orderId: row.order_id,
    tenantId: row.tenant_id,
    discrepancyDiram: BigInt(row.metadata.discrepancyDiram ?? '0'),
    repeatDetectionCount: row.metadata.repeatDetectionCount ?? 0,
    detectedAt: row.created_at,
  }
}

export const AUDIT_LOG_PORT_PROVIDER = {
  provide: AUDIT_LOG_PORT,
  useClass: RawSqlAuditLogRepository,
} as const
