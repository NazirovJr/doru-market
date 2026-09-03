/**
 * `OrdersUnitOfWorkPort` (EP-09, DTJ-227, D-EP09-21) — минимальный UoW-паттерн для
 * транзакции ОДНОЙ группы checkout (SRS-ORD-019).
 *
 * `modules/auth/application/ports/unit-of-work.port.ts` (DTJ-024) не переиспользуется
 * напрямую — CTO закрыл вопрос явно (D-EP09-21, `reports/EP09-CTO-BRIEF.md`): порт
 * модуль-локален, межмодульное переиспользование application-порта чужого bounded context
 * запрещено (`02` §1.2/§1.3 — application не знает о infrastructure чужого модуля, а порт
 * ДРУГОГО модуля — не публичный контракт, экспортируемый через `index.ts`). Контракт и
 * реализация — 1:1 копия паттерна (`DrizzleUnitOfWorkAdapter`, волна 5), не изобретение
 * нового механизма (правило 12 AGENTS.md).
 *
 * `run()` вызывается `CheckoutUseCase.execute()` РОВНО РАЗ НА ГРУППУ (не на весь checkout,
 * DoD тикета) — провал одной аптеки коммитит/откатывает СВОЮ транзакцию независимо от
 * остальных групп того же запроса.
 */
import type { OrderUnitOfWorkTx } from './order-repository.port.js'

export const ORDERS_UNIT_OF_WORK = Symbol.for('@dorutj/orders/unit-of-work')

export type { OrderUnitOfWorkTx }

export type OrdersUnitOfWorkCallback<T> = (tx: OrderUnitOfWorkTx) => Promise<T>

export interface OrdersUnitOfWorkPort {
  run<T>(callback: OrdersUnitOfWorkCallback<T>): Promise<T>
}
