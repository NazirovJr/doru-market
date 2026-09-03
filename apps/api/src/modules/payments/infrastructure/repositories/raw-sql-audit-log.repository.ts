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
} from '@/modules/payments/application/ports/audit-log.port.js'

const PAYMENT_OVERRIDE_CATEGORY = 'payment_override'
const ORDER_ENTITY_TYPE = 'order'
const WEBHOOK_EVENT_ENTITY_TYPE = 'payment_webhook_event'

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
}

export const AUDIT_LOG_PORT_PROVIDER = {
  provide: AUDIT_LOG_PORT,
  useClass: RawSqlAuditLogRepository,
} as const
