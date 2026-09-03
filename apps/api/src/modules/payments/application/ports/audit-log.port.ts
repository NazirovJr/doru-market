/**
 * Порт `AuditLogPort` (EP-10, DTJ-243, SRS-PAY-028) — api-side запись `audit_log` для
 * webhook-пограничных случаев. Append-only на уровне привилегий роли БД (`REVOKE UPDATE,
 * DELETE`, миграция `0034_support_tickets_audit_log.sql`) — этот интерфейс сам НЕ несёт
 * `update`/`delete` (компиляционная гарантия, тот же приём, что `EscrowLedgerRepository`).
 *
 * ОТДЕЛЬНЫЙ от `apps/worker`'s `AuditLogPort` (DTJ-247) — см. JSDoc `support-ticket.port.ts`
 * про необходимое дублирование через границу процесса И про DISPUTED-статус (сырой SQL, не
 * типизированный Drizzle — `audit_log` в `files_owned` DTJ-270).
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
}

export interface AuditLogPort {
  appendPaymentOverride(input: AppendPaymentOverrideAuditInput): Promise<void>
}
