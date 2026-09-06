/**
 * DI-токен `ORDERS_FACADE_PORT` (DTJ-350, EP-15) — сужение `OrdersFacade` (`@/modules/orders`,
 * `ORDERS_FACADE`) до методов, реально нужных use case'ам `admin` (Interface Segregation,
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3). Прямой импорт `modules/orders/domain|application|
 * infrastructure/*` запрещён (§1.1/§1.2, ловится `pnpm arch:check`).
 *
 * Тот же приём отложенной типизации, что `onboarding-facade.port.ts` рядом (см. его JSDoc за
 * полным обоснованием): токен объявлен сейчас, интерфейс — когда появится первый метод
 * (DTJ-351..367). `admin.module.ts` связывает токен с РЕАЛЬНЫМ `ORDERS_FACADE` (уже
 * забинженным в `orders.module.ts` на `OrdersFacade`) через `useExisting`.
 *
 * // заполняется тикетами DTJ-351..367
 */
export const ORDERS_FACADE_PORT = Symbol.for('@dorutj/admin/orders-facade-port')
