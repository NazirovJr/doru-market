/**
 * Порт `PaymentsUnitOfWorkPort` (EP-10, DTJ-242, D-EP09-21 приём) — транзакция ОДНОГО
 * вебхука. 1:1 паттерн `orders/application/ports/unit-of-work.port.ts` (DTJ-227): порт
 * модуль-локален, межмодульное переиспользование `application`-порта чужого bounded context
 * запрещено (`02` §1.2/§1.3 — то же решение, что D-EP09-21 зафиксировало для `orders`).
 *
 * `HandlePaymentWebhookUseCase.execute()` вызывает `run()` РОВНО РАЗ на входящий вебхук —
 * идемпотентная вставка `payment_operations` (SRS-DOM-164), `order.markPaidEscrow()`
 * (SRS-ORD-027a), `EscrowLedger.append(hold_created)` (SRS-DOM-180) и запись `outbox`
 * (`OrderPaidEvent`) — ОДНА транзакция БД: правило задания 2 («не открывай транзакцию, участники
 * которой в ней не участвуют») — каждый из этих четырёх вызовов ОБЯЗАН получить ТОТ ЖЕ `tx`.
 */
import type { PaymentsUnitOfWorkTx } from './orders-facade.port.js'

export const PAYMENTS_UNIT_OF_WORK = Symbol.for('@dorutj/payments/unit-of-work')

export type { PaymentsUnitOfWorkTx }

export type PaymentsUnitOfWorkCallback<T> = (tx: PaymentsUnitOfWorkTx) => Promise<T>

export interface PaymentsUnitOfWorkPort {
  run<T>(callback: PaymentsUnitOfWorkCallback<T>): Promise<T>
}
