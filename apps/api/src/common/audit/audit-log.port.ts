/**
 * `AuditLogPort` (EP-16, DTJ-374, SRS-ADM-001/062-064) — ЕДИНСТВЕННЫЙ способ для ЛЮБОГО
 * модуля писать в `audit_log`. Объявлен здесь, в `common/audit` (не внутри одного bounded
 * context) — тот же файл реэкспортируется/инжектится ЛЮБЫМ потребителем через
 * `AuditLogModule` (`@Global()`, см. её JSDoc).
 *
 * `write()` — ЕДИНСТВЕННЫЙ метод порта. НЕТ `update`/`delete`/`patch` ни в интерфейсе, ни в
 * реализации — АРХИТЕКТУРНЫЙ уровень защиты неизменяемости (`SRS-ADM-064` п.1): сам
 * TypeScript-интерфейс физически не предлагает мутирующих методов, поэтому вызывающий код НЕ
 * МОЖЕТ их вызвать, даже случайно (компиляционная гарантия — см. `audit-log.port.spec.ts`).
 * ВТОРОЙ, независимый, эксплуатационный уровень — `REVOKE UPDATE, DELETE ON audit_log FROM
 * app_role` (`migrations/0034_support_tickets_audit_log.sql`, повторно закреплено этим
 * тикетом как `migrations/0046_audit_log_revoke_update_delete.sql`).
 *
 * ОТДЕЛЬНЫЙ от `modules/payments/application/ports/audit-log.port.ts` (`AUDIT_LOG_PORT`,
 * DTJ-243/246, узкий `appendPaymentOverride()` под один use case) — тот порт создан ДО этого
 * тикета (EP-10, волна раньше EP-16) и вне периметра `files_owned` DTJ-374 (миграция
 * существующих вызовов на общий порт — отдельная задача, не эта). Этот, общий `AuditLogPort`
 * — единственный порт для ВСЕХ НОВЫХ потребителей (`DTJ-354`/`DTJ-356`/`DTJ-359`/`DTJ-376` и
 * далее, `blocks` тикета).
 */
import type { AuditEntryProps } from './domain/audit-entry.js'

export const AUDIT_LOG_PORT = Symbol.for('@dorutj/common/audit-log-port')

/** Публичный входной тип порта — 1:1 форма `AuditEntry.create()` (`domain/audit-entry.ts`),
 * под собственным именем для потребителей, которым не нужно знать про доменный класс. */
export type AuditEntryInput = AuditEntryProps

export interface AuditLogPort {
  write(entry: AuditEntryInput): Promise<void>
}
