/**
 * Порт `AuditLogPort` (EP-10, DTJ-243/246, SRS-PAY-028/018) — api-side запись `audit_log`.
 * Append-only на уровне привилегий роли БД (`REVOKE UPDATE, DELETE`, миграция
 * `0034_support_tickets_audit_log.sql`) — этот интерфейс сам НЕ несёт `update`/`delete`
 * (компиляционная гарантия, тот же приём, что `EscrowLedgerRepository`).
 *
 * ОТДЕЛЬНЫЙ от `apps/worker`'s `AuditLogPort` (DTJ-247) — см. JSDoc `support-ticket.port.ts`
 * про необходимое дублирование через границу процесса И про DISPUTED-статус (сырой SQL, не
 * типизированный Drizzle — `audit_log` в `files_owned` DTJ-270).
 *
 * `reason`/`actorUserId` — ДОБАВЛЕНО (DTJ-246, аддитивно): собственные колонки `audit_log`
 * (`reason TEXT`/`actor_user_id UUID`, не поля `metadata` — миграция `0034` резервирует их
 * отдельно ИМЕННО для `payment_override`/`ledger_adjustment`, см. `COMMENT ON TABLE audit_log`).
 * DTJ-243 (неизвестный платёж) их не заполняет (`null` — нет ни причины, ни человека-актора).
 */
export const AUDIT_LOG_PORT = Symbol.for('@dorutj/payments/audit-log-port')

export interface AppendPaymentOverrideAuditInput {
  readonly tenantId: string | null
  /** `null`, если реальной сущности (заказа) нет — SRS-PAY-028 «неизвестный платёж».
   * `audit_log.entity_id UUID NOT NULL` — адаптер минтит суррогатный id для этого случая
   * (инфраструктурная деталь, не заботa application-слоя, см. JSDoc адаптера). */
  readonly entityId: string | null
  readonly action: string
  readonly metadata: Record<string, unknown>
  /** DTJ-246 — обязателен для `AdminPaymentOverrideUseCase` (валидируется ДО вызова порта). */
  readonly reason?: string
  readonly actorUserId?: string
}

export interface AuditLogPort {
  appendPaymentOverride(input: AppendPaymentOverrideAuditInput): Promise<void>
}
