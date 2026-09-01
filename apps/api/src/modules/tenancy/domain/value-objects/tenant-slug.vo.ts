/**
 * `TenantSlug` — уникальный строковый идентификатор тенанта в URL/Host (SRS-DOM-084,
 * `^[a-z0-9-]{3,32}$`). Содержит список зарезервированных значений
 * (`RESERVED_SLUGS`) — единственный источник в кодовой базе, переиспользуется DTJ-057
 * на уровне use case для `ReservedTenantSlugError`.
 *
 * `isReserved` — публичный предикат, чтобы `ProvisionTenantUseCase` мог среагировать
 * отдельной доменной ошибкой (не валидационной, а семантической: «такое имя занято под
 * системные нужды»), не дублируя литерал.
 */
import { ValidationError } from '@dorutj/contracts'

const SLUG_PATTERN = /^[a-z0-9-]{3,32}$/

/**
 * Список зарезервированных значений (SRS-DOM-084). `'neutral'` разрешён только для
 * системного нейтрального тенанта, остальные — запрещены как slug новой White-Label
 * сети (ломают инфраструктуру — `admin`/`api`/`www` — или конфликтуют с публичными
 * путями — `app`/`static`).
 */
export const RESERVED_SLUGS = ['neutral', 'admin', 'api', 'www', 'app', 'static'] as const

export type ReservedSlug = (typeof RESERVED_SLUGS)[number]

export class TenantSlug {
  private constructor(public readonly value: string) {}

  /**
   * Парсит и валидирует сырую строку. Проверяет формат `^[a-z0-9-]{3,32}$`, бросает
   * `ValidationError` при несоответствии. НЕ проверяет резервированность — это
   * семантическая операция, вызывающий код решает, что с ней делать (`isReserved()`).
   */
  static parse(raw: string): TenantSlug {
    if (typeof raw !== 'string' || !SLUG_PATTERN.test(raw)) {
      throw new ValidationError('Invalid tenant slug: expected ^[a-z0-9-]{3,32}$', { field: 'slug' })
    }
    return new TenantSlug(raw)
  }

  /** Предикат для `ProvisionTenantUseCase` (DTJ-057): `true` если slug из системного списка. */
  isReserved(): boolean {
    return RESERVED_SLUGS.includes(this.value as ReservedSlug)
  }

  equals(other: TenantSlug): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
