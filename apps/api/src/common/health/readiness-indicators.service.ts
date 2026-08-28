import { Inject, Injectable } from '@nestjs/common'
import type { HealthIndicatorFunction } from '@nestjs/terminus'
import { PostgresReadinessIndicator } from './postgres-readiness.indicator.js'
import { RedisReadinessIndicator } from './redis-readiness.indicator.js'

/**
 * Группирует readiness-индикаторы (SRS-NFR-037) для `HealthCheckService.check(...)`.
 * Вынесено отдельным сервисом, а не инжектируется по одному в контроллер, — иначе
 * конструктор контроллера превысил бы порог C5 (≤3 параметров).
 */
@Injectable()
export class ReadinessIndicators {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001.
  constructor(
    @Inject(PostgresReadinessIndicator) private readonly postgres: PostgresReadinessIndicator,
    @Inject(RedisReadinessIndicator) private readonly redis: RedisReadinessIndicator,
  ) {}

  list(): HealthIndicatorFunction[] {
    return [() => this.postgres.check(), () => this.redis.check()]
  }
}
