/**
 * `@Idempotent()` (EP-01, DTJ-019, SRS-API-009/010/076) — маркер маршрута,
 * требующего `Idempotency-Key` заголовок.
 *
 * Контракт: `IdempotencyInterceptor` (DTJ-019) активируется ТОЛЬКО на
 * маршрутах, помеченных этим декоратором. Без декоратора — заголовок
 * игнорируется (не ошибка, не пассивное требование — НЕ требуется).
 *
 * Использует `SetMetadata`/`Reflector` по тому же паттерну, что
 * `@Roles(...)` (DTJ-022).
 */
import { SetMetadata } from '@nestjs/common'

export const IDEMPOTENT_METADATA_KEY = Symbol.for('@dorutj/common/idempotent')

/** `@Idempotent()` — пометить method контроллера как требующий `Idempotency-Key`. */
export const Idempotent = (): MethodDecorator & ClassDecorator => {
  return SetMetadata(IDEMPOTENT_METADATA_KEY, true)
}
