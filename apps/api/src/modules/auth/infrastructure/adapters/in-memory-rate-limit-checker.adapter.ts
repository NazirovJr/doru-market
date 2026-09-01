/**
 * `InMemoryRateLimitCheckerAdapter` (EP-01, DTJ-023) — тестовая/dev реализация
 * `RateLimitCheckerPort`. Хранит счётчики в `Map`; TTL аппроксимируется через
 * `Date.now()` в адаптере. НЕ предназначен для production (D-04: всё, что
 * в продуктовом пути — на Redis; этот адаптер — для unit-тестов use case и
 * для запуска API без Redis в dev-режиме).
 */
import { Inject, Injectable } from '@nestjs/common'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckResult,
  type RateLimitCheckerPort,
} from '@/modules/auth/application/ports/rate-limit-checker.port.js'
// Внутренний импорт shared-kernel — ПРЯМО из файла.
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'

interface Counter {
  count: number
  expiresAtMs: number
}

@Injectable()
export class InMemoryRateLimitCheckerAdapter implements RateLimitCheckerPort {
  private readonly counters = new Map<string, Counter>()

  // Явный @Inject: `Clock` — интерфейс порта, у него нет рантайм-представления
  // для DI по типу (esbuild/vitest тем более не эмитит `design:paramtypes`, см. DTJ-001).
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  incrementAndGet(key: string, windowSeconds: number): Promise<RateLimitCheckResult> {
    const now = this.clock.now().getTime()
    const windowMs = windowSeconds * 1000
    const existing = this.counters.get(key)
    if (existing === undefined || existing.expiresAtMs <= now) {
      this.counters.set(key, { count: 1, expiresAtMs: now + windowMs })
      return Promise.resolve({ count: 1, ttlSeconds: windowSeconds })
    }
    existing.count += 1
    const ttlSeconds = Math.max(1, Math.ceil((existing.expiresAtMs - now) / 1000))
    return Promise.resolve({ count: existing.count, ttlSeconds })
  }
}

export { RATE_LIMIT_CHECKER }
