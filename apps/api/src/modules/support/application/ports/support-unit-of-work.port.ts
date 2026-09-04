/**
 * Порт `SupportUnitOfWorkPort` (EP-14, DTJ-279). Файл СВЕРХ буквального `files_owned`
 * DTJ-279 (тот же приём, что DTJ-240 добавил `escrow-ledger-repository.port.ts` сверх списка,
 * правило 11 AGENTS.md) — `CreateSupportTicketUseCase` не может выполнить критерий приёмки 4
 * («SupportTicketCreatedEvent опубликован в outbox в ТОЙ ЖЕ транзакции, что INSERT
 * support_tickets») без единицы работы. 1:1 паттерн `payments/application/ports/
 * payments-unit-of-work.port.ts` (DTJ-242) — порт модуль-локален (`02` §1.2/§1.3, D-EP09-21).
 */
export const SUPPORT_UNIT_OF_WORK = Symbol.for('@dorutj/support/unit-of-work')

export type SupportUnitOfWorkTx = unknown

export type SupportUnitOfWorkCallback<T> = (tx: SupportUnitOfWorkTx) => Promise<T>

export interface SupportUnitOfWorkPort {
  run<T>(callback: SupportUnitOfWorkCallback<T>): Promise<T>
}
