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
 *
 * `findByFilters()` реализует второй, read-only интерфейс — таблица не типизирована Drizzle-схемой,
 * поэтому фильтры/курсор собираются как raw SQL-фрагменты (`sql.join`), а не `and(...)`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql, type SQL } from 'drizzle-orm'
import { maskSensitiveFields } from '@dorutj/contracts'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditEntry } from '../domain/audit-entry.js'
import { AUDIT_LOG_PORT, type AuditEntryInput, type AuditLogPort } from '../audit-log.port.js'
import {
  AUDIT_LOG_QUERY_PORT,
  type AuditLogEntryView,
  type AuditLogFilter,
  type AuditLogListCursor,
  type AuditLogListPage,
  type AuditLogListQuery,
  type AuditLogQueryPort,
} from '../audit-log-query.port.js'

@Injectable()
export class AuditLogRepository implements AuditLogPort, AuditLogQueryPort {
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

  public async findByFilters(query: AuditLogListQuery): Promise<AuditLogListPage> {
    const conditions = buildFilterConditions(query.filter, query.cursor ?? null)
    const whereClause = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``
    const result = await this.db.execute(sql`
      SELECT id, category, entity_type, entity_id, actor_user_id, action, reason, metadata, request_id, tenant_id, created_at
      FROM audit_log
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${query.limit + 1}
    `)
    const rows = extractRows(result)
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toEntryView),
      nextCursor: hasMore && last !== undefined ? { v: normalizeCreatedAt(last.created_at).toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

export const AUDIT_LOG_PORT_PROVIDER = {
  provide: AUDIT_LOG_PORT,
  useClass: AuditLogRepository,
} as const

export const AUDIT_LOG_QUERY_PORT_PROVIDER = {
  provide: AUDIT_LOG_QUERY_PORT,
  useClass: AuditLogRepository,
} as const

function buildFilterConditions(filter: AuditLogFilter, cursor: AuditLogListCursor | null): SQL[] {
  const conditions: SQL[] = []
  if (filter.category !== undefined) conditions.push(sql`category = ${filter.category}`)
  if (filter.entityType !== undefined) conditions.push(sql`entity_type = ${filter.entityType}`)
  if (filter.entityId !== undefined) conditions.push(sql`entity_id = ${filter.entityId}`)
  if (filter.actorUserId !== undefined) conditions.push(sql`actor_user_id = ${filter.actorUserId}`)
  if (filter.tenantId !== undefined) conditions.push(sql`tenant_id = ${filter.tenantId}`)
  if (filter.createdAtFrom !== undefined) conditions.push(sql`created_at >= ${filter.createdAtFrom}`)
  if (filter.createdAtTo !== undefined) conditions.push(sql`created_at <= ${filter.createdAtTo}`)
  if (cursor !== null) {
    const anchor = new Date(cursor.v)
    conditions.push(sql`(created_at < ${anchor} OR (created_at = ${anchor} AND id < ${cursor.id}))`)
  }
  return conditions
}

interface AuditLogRow {
  readonly id: string
  readonly category: string
  readonly entity_type: string
  readonly entity_id: string
  readonly actor_user_id: string | null
  readonly action: string
  readonly reason: string | null
  readonly metadata: Record<string, unknown>
  readonly request_id: string | null
  readonly tenant_id: string | null
  readonly created_at: Date | string
}

function extractRows(result: unknown): readonly AuditLogRow[] {
  if (Array.isArray(result)) {
    return result as AuditLogRow[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as AuditLogRow[]
    }
  }
  return []
}

function toEntryView(row: AuditLogRow): AuditLogEntryView {
  return {
    id: row.id,
    category: row.category,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    reason: row.reason,
    metadata: row.metadata,
    requestId: row.request_id,
    tenantId: row.tenant_id,
    createdAt: normalizeCreatedAt(row.created_at),
  }
}

function normalizeCreatedAt(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
