/**
 * Порт `PaymentsOutboxPort` (EP-10, DTJ-242, SRS-DOM-151/152) — публикация `PaymentsDomainEvent`
 * (`domain/payment-domain-event.ts`) в ТОЙ ЖЕ единице работы, что мутация заказа/леджера. 1:1
 * паттерн `orders/application/ports/orders-outbox.port.ts` (DTJ-227) — заведён заново, не
 * импортирован оттуда (межмодульный deep-import чужого `application/**` запрещён, `02` §1.2),
 * пишет в ОБЩУЮ таблицу `outbox` (EP-01, DTJ-016, `db/schema/outbox.schema.ts`), которую читает
 * общий `OutboxRelayWorker`.
 *
 * `append` — ОБЯЗАН быть `await`-нут ВНУТРИ транзакции вебхука (`PaymentsUnitOfWorkPort.run`,
 * тот же `tx`, что `EscrowLedgerRepository.append`/`PaymentsOrdersPort.markPaidEscrow`) —
 * SRS-DOM-151: fire-and-forget здесь означал бы, что заказ переведён в `paid_escrow`, а
 * `OrderPaidEvent` потерян при сбое между `COMMIT` и записью в outbox — недопустимо (аудит/
 * уведомления зависят от факта публикации).
 */
import type { PaymentsDomainEvent } from '@/modules/payments/domain/payment-domain-event.js'
import type { PaymentsUnitOfWorkTx } from './orders-facade.port.js'

export const PAYMENTS_OUTBOX = Symbol.for('@dorutj/payments/outbox')

export interface PaymentsOutboxPort {
  append(tenantId: string, event: PaymentsDomainEvent, tx: PaymentsUnitOfWorkTx): Promise<void>
}
