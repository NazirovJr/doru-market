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
 * `metadata` МАСКИРУЕТСЯ (`maskSensitiveMetadataFields`) ПЕРЕД `INSERT` — ВТОРОЙ, более
 * глубокий (рекурсивный по всей структуре) рубеж защиты секретов, ПОСЛЕ того как
 * `AuditEntry.create()` (`../domain/audit-entry.ts`) уже отверг запись целиком, если
 * `before`/`after`/`extra` содержат запрещённое поле. Переиспользует ТОТ ЖЕ константный
 * список полей (`SENSITIVE_METADATA_FIELDS`, домен) — не заводит вторую независимую копию
 * (риск расхождения списков, C15 AGENTS.md). Defense-in-depth того же духа, что связка
 * интерфейс+`REVOKE` (SRS-ADM-064): маскирование переживает будущую правку кода, которая по
 * ошибке уберёт вызов `AuditEntry.create()` выше по стеку.
 *
 * `requestId` дублируется В МЕТАДАННЫХ (канонический формат `{ before?, after?, requestId,
 * extra? }`, SRS-ADM-063) И отдельной колонкой `request_id` (быстрый `WHERE request_id = ...`
 * без JSONB-оператора, корреляция с pino-логами, `11-database-schema.md` §40) — не
 * расхождение, оба нужны по разным причинам.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditEntry, SENSITIVE_METADATA_FIELDS } from '../domain/audit-entry.js'
import { AUDIT_LOG_PORT, type AuditEntryInput, type AuditLogPort } from '../audit-log.port.js'

export const MASKED_METADATA_VALUE = '***MASKED***'

@Injectable()
export class AuditLogRepository implements AuditLogPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async write(input: AuditEntryInput): Promise<void> {
    const entry = AuditEntry.create(input)
    const metadataWithRequestId = { ...entry.metadata, requestId: entry.requestId }
    const maskedMetadata = maskSensitiveMetadataFields(metadataWithRequestId)

    await this.db.execute(sql`
      INSERT INTO audit_log (category, entity_type, entity_id, actor_user_id, action, reason, metadata, request_id, tenant_id)
      VALUES (
        ${entry.category}, ${entry.entityType}, ${entry.entityId}, ${entry.actorUserId}, ${entry.action},
        ${entry.reason}, ${JSON.stringify(maskedMetadata)}::jsonb, ${entry.requestId}, ${entry.tenantId}
      )
    `)
  }
}

/** Рекурсивно заменяет значения запрещённых ключей (см. JSDoc файла) — обходит объекты и
 * массивы на любую глубину, не только верхний уровень `before`/`after`/`extra`. */
export function maskSensitiveMetadataFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitiveMetadataFields)
  if (value === null || typeof value !== 'object') return value
  const masked: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    masked[key] = (SENSITIVE_METADATA_FIELDS as readonly string[]).includes(key)
      ? MASKED_METADATA_VALUE
      : maskSensitiveMetadataFields(nested)
  }
  return masked
}

export const AUDIT_LOG_PORT_PROVIDER = {
  provide: AUDIT_LOG_PORT,
  useClass: AuditLogRepository,
} as const
