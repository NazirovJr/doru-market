/**
 * `AuditEntry` (EP-16, DTJ-374, SRS-ADM-001/062/063/064) — минимальный Value Object одной
 * строки `audit_log` (таблица уже существует, `migrations/0034_support_tickets_audit_log.sql`,
 * `11-database-schema.md` §40). `common/audit` — сквозной инфраструктурный сервис, НЕ bounded
 * context (`SRS-ADM-001`): владелец — `identity`, пишется из ЛЮБОГО модуля через
 * `AuditLogPort` (`../audit-log.port.ts`), поэтому у него нет своих `application`/
 * `presentation` — только `domain` + порт + `infrastructure`-репозиторий.
 *
 * Приватный конструктор + фабрика `create()` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.2):
 * `metadata` ПРОВЕРЯЕТСЯ конструктором как ИНВАРИАНТ — секрет (`apiKey`/`hmacSecret`/
 * `codeHash`/`password`/`refreshToken`/`accessToken`) никогда не попадает в доменный объект,
 * даже если вызывающий код ошибся (например, передал ПОЛНЫЙ снепшот сущности вместо только
 * изменившихся полей — SRS-ADM-063 требует именно дельту в `before`/`after`, а типичный полный
 * снепшот пользователя почти всегда несёт поле вида `password`/`passwordHash`, так что это же
 * правило заодно дисциплинирует вызывающий код). Это ПЕРВЫЙ рубеж защиты SRS-ADM-064
 * (архитектурный); ВТОРОЙ, независимый — эксплуатационный `REVOKE UPDATE, DELETE` на уровне
 * роли БД (`migrations/0046_audit_log_revoke_update_delete.sql`).
 *
 * Список запрещённых полей (`DTJ-375`) — ЕДИНЫЙ `SENSITIVE_FIELD_NAMES` из `@dorutj/contracts`
 * (`packages/contracts/src/sensitive-fields.ts`), тот же, что читает pino-редактор
 * (`common/logging/pino-redaction.config.ts`). `infrastructure/audit-log.repository.ts`
 * ПЕРЕИСПОЛЬЗУЕТ ТОТ ЖЕ источник — через `maskSensitiveFields` (второй, более глубокий рубеж
 * defense-in-depth ПЕРЕД `INSERT`) — не заводит собственную копию (риск C15 AGENTS.md).
 *
 * `category`/`entityType`/`action` — намеренно `string`, не enum: `audit_action_category`
 * (Postgres enum) уже ограничивает `category` на уровне БД (`INSERT` с недопустимым
 * значением упадёт кодом `22P02`), а `entityType`/`action` — свободный `VARCHAR` по исходной
 * схеме. Тикет DTJ-374 намеренно НЕ вводит валидацию допустимых значений здесь (см. «Риски»
 * тикета) — порт обязан оставаться общим для ЛЮБЫХ будущих категорий действий, эта
 * ответственность остаётся за вызывающим кодом на местах вызова `write()`.
 */
import { SENSITIVE_FIELD_NAMES } from '@dorutj/contracts'
import { SensitiveMetadataFieldError } from './errors/sensitive-metadata-field.error.js'

/** SRS-ADM-063 — форма `metadata` ЕДИНАЯ для ВСЕХ категорий. `before`/`after` — ТОЛЬКО
 * изменившиеся поля, не полный снепшот сущности. `requestId` в саму `metadata` (дублируя
 * колонку `audit_log.request_id`) добавляет `infrastructure/audit-log.repository.ts` перед
 * `INSERT` — здесь его нет, чтобы не задавать один и тот же вход дважды. */
export interface AuditEntryMetadata {
  readonly before?: Record<string, unknown>
  readonly after?: Record<string, unknown>
  readonly extra?: Record<string, unknown>
}

export interface AuditEntryProps {
  readonly category: string
  readonly entityType: string
  readonly entityId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly reason?: string
  readonly metadata: AuditEntryMetadata
  readonly requestId: string | null
  readonly tenantId: string | null
}

export class AuditEntry {
  readonly category: string
  readonly entityType: string
  readonly entityId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly reason: string | null
  readonly metadata: AuditEntryMetadata
  readonly requestId: string | null
  readonly tenantId: string | null

  private constructor(props: AuditEntryProps) {
    this.category = props.category
    this.entityType = props.entityType
    this.entityId = props.entityId
    this.actorUserId = props.actorUserId
    this.action = props.action
    this.reason = props.reason ?? null
    this.metadata = props.metadata
    this.requestId = props.requestId
    this.tenantId = props.tenantId
  }

  /**
   * Фабрика — единственный легальный способ получить `AuditEntry`. Given `metadata.before`/
   * `after`/`extra` содержит запрещённое поле (см. `SENSITIVE_FIELD_NAMES`, `@dorutj/contracts`) → бросает
   * `SensitiveMetadataFieldError` (AC3 DTJ-374) — рекурсивно, не только на верхнем уровне
   * каждого контейнера, чтобы вложенный секрет тоже не проскочил.
   */
  static create(props: AuditEntryProps): AuditEntry {
    assertNoSensitiveFields(props.metadata)
    return new AuditEntry(props)
  }
}

function assertNoSensitiveFields(metadata: AuditEntryMetadata): void {
  const offendingField =
    findSensitiveField(metadata.before) ?? findSensitiveField(metadata.after) ?? findSensitiveField(metadata.extra)
  if (offendingField !== null) {
    throw new SensitiveMetadataFieldError(offendingField)
  }
}

function findSensitiveField(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    return findSensitiveFieldInArray(value)
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((SENSITIVE_FIELD_NAMES as readonly string[]).includes(key)) return key
    const found = findSensitiveField(nested)
    if (found !== null) return found
  }
  return null
}

function findSensitiveFieldInArray(items: readonly unknown[]): string | null {
  for (const item of items) {
    const found = findSensitiveField(item)
    if (found !== null) return found
  }
  return null
}
