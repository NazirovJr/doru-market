/**
 * Порт `IdGenerator` (EP-01, DTJ-006).
 *
 * `domain`/`application` НЕ ДОЛЖНЫ вызывать `crypto.randomUUID()` / `Math.random()`
 * напрямую — `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6. Идентификаторы приходят
 * через порт, чтобы тесты были детерминированы (`testing-kit/SequentialIdGenerator`).
 *
 * Возвращаемое значение — UUID v7 (time-ordered) на проде; в тестах — последовательный
 * `1`, `2`, `3` и т.п. для предсказуемой проверки.
 */
export const ID_GENERATOR = Symbol.for('@dorutj/shared-kernel/id-generator')

export interface IdGenerator {
  /** Свежий уникальный идентификатор. На проде — UUID v7. */
  next(): string
}
