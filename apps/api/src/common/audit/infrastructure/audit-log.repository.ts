/**
 * `AuditLogRepository` (EP-16, DTJ-374, SRS-ADM-063/064) — единственная production-реализация
 * общего `AuditLogPort`. `write()` выполняет ТОЛЬКО `INSERT` — ни `UPDATE`, ни `DELETE` не
 * существуют ни в этом классе, ни в интерфейсе порта (см. JSDoc `../audit-log.port.ts` про
 * оба независимых рубежа неизменяемости, SRS-ADM-064).
 *
 * Сырой `db.execute(sql...)`, НЕ типизированный Drizzle `pgTable` — `audit_log` до сих пор не
 * заведена в `db/schema/**` ни одним тикетом (DDL уже существует в БД, `migrations/
 * 0034_support_tickets_audit_log.sql`, но её типизация — заготовленный периметр DTJ-270,
 * который эту таблицу не тронул; вне `files_owned` DTJ-374 заводить схему самостоятельно).
 * Тот же приём и то же обоснование, что `modules/payments/infrastructure/repositories/
 * raw-sql-audit-log.repository.ts` (DTJ-243) — см. её JSDoc.
 *
 * `metadata` МАСКИРУЕТСЯ (`maskSensitiveFields`) ПЕРЕД `INSERT` — второй рубеж НА СЛУЧАЙ, если
 * `AuditEntry.create()` выше по стеку перестанет отклонять запись. Асимметрично pino: там
 * маскирование — единственная стратегия (лог не может отказаться писаться), здесь — страховка
 * поверх отказа домена, не менять один механизм под другой по аналогии.
 *
 * `requestId` дублируется В МЕТАДАННЫХ (канонический формат `{ before?, after?, requestId,
 * extra? }`, SRS-ADM-063) И отдельной колонкой `request_id` (быстрый `WHERE request_id = ...`
 * без JSONB-оператора, корреляция с pino-логами, `11-database-schema.md` §40) — не
 * расхождение, оба нужны по разным причинам.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { maskSensitiveFields } from '@dorutj/contracts'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditEntry } from '../domain/audit-entry.js'
import { AUDIT_LOG_PORT, type AuditEntryInput, type AuditLogPort } from '../audit-log.port.js'

@Injectable()
export class AuditLogRepository implements AuditLogPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async write(input: AuditEntryInput): Promise<void> {
    const entry = AuditEntry.create(input)
    const metadataWithRequestId = { ...entry.metadata, requestId: entry.requestId }
    const maskedMetadata = maskSensitiveFields(metadataWithRequestId)

    await this.db.execute(sql`
      INSERT INTO audit_log (category, entity_type, entity_id, actor_user_id, action, reason, metadata, request_id, tenant_id)
      VALUES (
        ${entry.category}, ${entry.entityType}, ${entry.entityId}, ${entry.actorUserId}, ${entry.action},
        ${entry.reason}, ${JSON.stringify(maskedMetadata)}::jsonb, ${entry.requestId}, ${entry.tenantId}
      )
    `)
  }
}

export const AUDIT_LOG_PORT_PROVIDER = {
  provide: AUDIT_LOG_PORT,
  useClass: AuditLogRepository,
} as const
