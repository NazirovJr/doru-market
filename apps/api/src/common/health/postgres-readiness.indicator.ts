import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus'
import { Pool } from 'pg'
// no-restricted-imports (C16): см. пояснение в health.module.ts — `@/` не резолвится
// нативным Node ESM в выводе `tsc`/`nest build` без bundler-шага (`assumptions` DTJ-001).
// eslint-disable-next-line no-restricted-imports
import { AppConfigService } from '../../config/app-config.service.js'
import { toReadableMessage } from './error-message.util.js'

const POSTGRES_HEALTH_KEY = 'postgres'
/** SRS-NFR-037: readiness обязан завершиться за 2с — таймаут применён и к соединению, и к запросу. */
const POSTGRES_HEALTH_TIMEOUT_MS = 2000
/** Пул только для readiness-проб — одно соединение достаточно, не смешивается с бизнес-пулом. */
const POSTGRES_HEALTH_POOL_SIZE = 1
const POSTGRES_HEALTH_QUERY = 'SELECT 1'

/**
 * SRS-NFR-037: `PostgresHealthIndicator` — `SELECT 1`, таймаут 2000мс. Минимальный
 * DI-провайдер поверх `pg` (DTJ-001, шаг 6) — полноценные Drizzle-репозитории появляются в
 * тикетах, которым они реально нужны (см. технический контекст тикета).
 */
@Injectable()
export class PostgresReadinessIndicator implements OnModuleDestroy {
  private readonly pool: Pool

  // Явный @Inject на обоих параметрах: esbuild (vitest) не эмитит `design:paramtypes`,
  // без него DI отказывает в тестах — не косметика, см. общий комментарий в DTJ-001.
  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(HealthIndicatorService) private readonly healthIndicatorService: HealthIndicatorService,
  ) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: POSTGRES_HEALTH_POOL_SIZE,
      connectionTimeoutMillis: POSTGRES_HEALTH_TIMEOUT_MS,
      query_timeout: POSTGRES_HEALTH_TIMEOUT_MS,
    })
  }

  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(POSTGRES_HEALTH_KEY)
    try {
      await this.pool.query(POSTGRES_HEALTH_QUERY)
      return indicator.up()
    } catch (error) {
      return indicator.down({ message: toReadableMessage(error) })
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
