/**
 * Порт `SupportTicketPort` (EP-10, DTJ-243, SRS-PAY-028/040) — api-side создание
 * `support_tickets(channel='system_auto')` для webhook-пограничных случаев
 * (`HandlePaymentWebhookUseCase.handleUnknownPayment`, `LatePaymentRefundService`).
 *
 * ОТДЕЛЬНЫЙ от `apps/worker`'s `SupportTicketPort` (`jobs/payout/escrow-reconciliation.job.ts`,
 * DTJ-247) — та же ситуация, что `EscrowLedgerImbalanceMetric`: `apps/api` и `apps/worker` —
 * ДВА разных Node-процесса/TS-проекта монорепо, физического импорта между ними нет.
 *
 * DISPUTED (см. отчёт сдачи DTJ-243/247): реализация адаптера — СЫРОЙ `db.execute(sql\`...\`)`,
 * НЕ типизированный Drizzle `pgTable`/`pgEnum` — `support_tickets`/`audit_log` концептуально
 * принадлежат EP-11/14 (`apps/api/src/db/schema/support.ts`, `files_owned` DTJ-270, параллельно
 * разрабатывается ДРУГИМ агентом на момент этого тикета) — типизированную Drizzle-схему заводит
 * ОН, не этот тикет (правило 7 AGENTS.md — не работа чужого эпика). Рекомендация: когда DTJ-270
 * закрепит `support.ts`, этот адаптер стоит перевести на типизированный `pgTable`.
 */
export const SUPPORT_TICKET_PORT = Symbol.for('@dorutj/payments/support-ticket-port')

export interface CreateSystemAutoTicketInput {
  readonly tenantId: string
  readonly orderId: string | null
  readonly category: 'payment_issue'
  readonly description: string
}

export interface SupportTicketPort {
  createSystemAutoTicket(input: CreateSystemAutoTicketInput): Promise<{ readonly ticketId: string }>
}
