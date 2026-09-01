/**
 * `TenantId` — обёртка над `UUID` (SRS-DOM-083). Неизменяемый, сравнение по значению.
 *
 * Чистый value object: фабрика `from(raw)` валидирует UUID-формат и бросает
 * `ValidationError` (`packages/contracts`) при невалидном входе. Никаких
 * `@nestjs/*`/`drizzle-orm`/I/O — это `domain`-слой (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 */
import { validate as isUuid } from 'uuid'
import { ValidationError } from '@dorutj/contracts'

export class TenantId {
  private constructor(public readonly value: string) {}

  /**
   * Фабрика из сырой строки. Невалидный UUID (не 36-символьный формат `xxxxxxxx-xxxx-...`)
   * → `ValidationError`. Метод не принимает `unknown`/`any` — узкая сигнатура VO,
   * типизация отсекает ошибочные входы на этапе компиляции.
   */
  static from(raw: string): TenantId {
    if (typeof raw !== 'string' || !isUuid(raw)) {
      throw new ValidationError('Invalid tenant id: expected UUID', { field: 'tenantId' })
    }
    return new TenantId(raw)
  }

  /** Сравнение по значению (VO, не entity). */
  equals(other: TenantId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
