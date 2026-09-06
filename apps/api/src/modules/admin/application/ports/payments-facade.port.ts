/**
 * DI-токен `PAYMENTS_FACADE_PORT` (DTJ-350, EP-15) — сужение `PaymentsFacade`
 * (`@/modules/payments`, `PAYMENTS_FACADE`) до методов, реально нужных use case'ам `admin`
 * (Interface Segregation, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3). Прямой импорт
 * `modules/payments/domain|application|infrastructure/*` запрещён (§1.1/§1.2, `pnpm arch:check`).
 *
 * Тот же приём отложенной типизации, что `onboarding-facade.port.ts` (см. его JSDoc).
 * `PAYMENTS_FACADE` уже забинжен в `payments.module.ts` (DTJ-249, `HoldPayoutUseCase` через
 * `useFactory`), но НЕ был в `exports:` этого модуля — добавлено ОДНОЙ строкой этим тикетом
 * (гостевая правка, правомочна по риску DTJ-350 «добавить метод/строку в чужой публичный
 * index.ts, если недостаёт для DI-видимости — но не реализовывать логику чужого модуля»).
 *
 * // заполняется тикетами DTJ-351..367
 */
export const PAYMENTS_FACADE_PORT = Symbol.for('@dorutj/admin/payments-facade-port')
