/**
 * Детерминированный тест-дублёр порта `ClockPort` (`docs/spec/10-domain-model.md` §2.6).
 * `SRS-NFR-030` п.1: часы продвигаются явным `advance(minutes)`, без реального `sleep()`,
 * что делает SLA/TTL-тесты (pickup_sla, OTP.ttlSeconds) детерминированными и мгновенными.
 *
 * ВАЖНО (см. «Риски» тикета DTJ-416): сигнатура синхронизируется с реальным `ClockPort` из
 * `packages/contracts` при его первом появлении (владелец — EP-01) — это ожидаемая точка
 * ревизии, не архитектурная ошибка данного класса.
 */

/** Стандартная точка отсчёта тестового набора (`SRS-NFR-030` п.1). */
const DEFAULT_TEST_TIME = '2026-08-27T09:00:00.000Z'

const MS_PER_MINUTE = 60_000

export class FixedClockAdapter {
  private current: Date

  constructor(initial: Date = new Date(DEFAULT_TEST_TIME)) {
    this.current = new Date(initial.getTime())
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  /** Продвигает внутренние часы на заданное число минут БЕЗ реальной паузы выполнения. */
  advance(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * MS_PER_MINUTE)
  }

  /** Сбрасывает часы к явно заданному времени или к стандартной точке отсчёта. */
  reset(to: Date = new Date(DEFAULT_TEST_TIME)): void {
    this.current = new Date(to.getTime())
  }
}
