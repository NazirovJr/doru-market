/**
 * `CourierSourcingMode` — строго типизированный enum (SRS-DOM-045). Невалидная строка
 * не принимается на уровне типа/конструктора, не в рантайме через «магическое» сравнение.
 */
export const COURIER_SOURCING_MODES = ['own_fleet', 'platform_pool', 'hybrid'] as const

export type CourierSourcingMode = (typeof COURIER_SOURCING_MODES)[number]

export class CourierSourcingModeVO {
  private constructor(public readonly value: CourierSourcingMode) {}

  static parse(raw: string): CourierSourcingModeVO {
    if (typeof raw !== 'string' || !COURIER_SOURCING_MODES.includes(raw as CourierSourcingMode)) {
      throw new Error(`Invalid courier sourcing mode: ${raw}`)
    }
    return new CourierSourcingModeVO(raw as CourierSourcingMode)
  }

  static platformPool(): CourierSourcingModeVO {
    return new CourierSourcingModeVO('platform_pool')
  }

  equals(other: CourierSourcingModeVO): boolean {
    return this.value === other.value
  }
}
