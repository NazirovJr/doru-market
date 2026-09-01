/**
 * Порт `Clock` (EP-01, DTJ-006).
 *
 * `domain`/`application` НЕ ДОЛЖНЫ вызывать `new Date()` / `Date.now()` напрямую —
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6. Время приходит через порт, чтобы тесты
 * были детерминированы (`testing-kit/FixedClock`).
 */
export const CLOCK = Symbol.for('@dorutj/shared-kernel/clock')

export interface Clock {
  /** Текущий момент в UTC. Domain/application не должны вызывать `new Date()`/`Date.now()`. */
  now(): Date
}
