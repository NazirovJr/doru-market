/**
 * Публичный фасад модуля `payments` (EP-10, DTJ-236, скаффолдинг).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь межмодульного
 * взаимодействия для чужих bounded contexts. Импорт `modules/payments/domain|application|
 * infrastructure|presentation` напрямую — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). Тот же приём, что `modules/orders/index.ts`
 * (`ORDERS_FACADE`).
 *
 * На этом шаге (DTJ-236) `PaymentsFacade` — ПУСТОЙ контракт: ни одного use case'а модуля ещё
 * не реализовано (`escrow_ledger`/`payout_schedule`-репозитории и use case'ы начинаются
 * DTJ-243/245). Токен `PAYMENTS_FACADE` объявлен здесь заранее (потребители — будущие
 * модули EP-11..EP-15, читающие ledger/payout), но НЕ забинжен ни к одному провайдеру в
 * `payments.module.ts` до появления первой реализации — попытка `@Inject(PAYMENTS_FACADE)`
 * до этого момента упадёт на резолвинге DI (осознанно: несуществующая реализация не
 * маскируется null-адаптером, т.к. ни один потребитель ещё не написан, правило 15 AGENTS.md
 * неприменимо — маркер нужен только когда ЕСТЬ вызывающий код).
 *
 * Интерфейс `PaymentsFacade` появится в этом файле ДОБАВЛЕНИЕМ (D-27), когда первый use
 * case модуля будет готов (DTJ-243+) — TypeScript не позволяет объявить непустой контракт
 * без реальных членов заранее, а пустой `interface {}` эквивалентен `unknown`/`object` и
 * запрещён линтером (`@typescript-eslint/no-empty-object-type`) как вводящий в заблуждение.
 * До этого момента межмодульные потребители фасада не существуют — токен ниже готов принять
 * `{ provide: PAYMENTS_FACADE, useClass: PaymentsFacade }` в `payments.module.ts`, когда
 * появится первая реализация.
 */

/** DI-токен провайдера `PaymentsFacade` (`{ provide: PAYMENTS_FACADE, useFactory: ... }`, см. `payments.module.ts`). */
export const PAYMENTS_FACADE = Symbol.for('@dorutj/payments/payments-facade')

/**
 * ДОБАВЛЕНО (DTJ-249) — интерфейс `PaymentsFacade` прибыл первым реальным методом
 * (`holdPayout`), как и предсказывал JSDoc выше (DTJ-236). Форма живёт в `application/ports/
 * payments-facade.port.ts` (тот же приём, что `orders-facade.port.ts`/`tenancy-facade.port.ts`
 * — порт объявляется в `application/`, `index.ts` лишь ре-экспортирует тип); реализация —
 * `HoldPayoutUseCase` через `useFactory` в `payments.module.ts` (метод `execute`, не
 * `holdPayout` — см. её JSDoc про несовпадение имён метода use case'а и метода фасада).
 */
export type { PaymentsFacade, HoldPayoutResult } from './application/ports/payments-facade.port.js'

/**
 * `PaymentInvoiceAdapter` (DTJ-241) — реализация `orders`-контракта `PaymentInvoicePort`
 * (`orders/index.ts` ре-экспорт `PAYMENT_INVOICE_PORT`). Экспортирован ЗДЕСЬ (класс, не
 * только токен) специально для `orders.module.ts`: `{ provide: PAYMENT_INVOICE_PORT,
 * useExisting: PaymentInvoiceAdapter }` требует, чтобы САМ КЛАСС был виден в scope
 * `OrdersModule` — единственный легальный путь получить его оттуда, не нарушая
 * `no-cross-module-deep-import` (`02` §1.2), это публичный фасад.
 */
export { PaymentInvoiceAdapter } from './infrastructure/adapters/payment-invoice.adapter.js'

/**
 * `RefundFacadeAdapter` (DTJ-245) — реализация `orders`-контракта `RefundFacadePort`
 * (`orders/index.ts` ре-экспорт `REFUND_FACADE_PORT`). Экспортирован ЗДЕСЬ (класс, не только
 * токен) специально для `orders.module.ts` — тот же приём, что `PaymentInvoiceAdapter` выше.
 */
export { RefundFacadeAdapter } from './infrastructure/adapters/refund-facade.adapter.js'
