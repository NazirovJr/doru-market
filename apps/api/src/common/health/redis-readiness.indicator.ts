import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus'
import Redis from 'ioredis'
// no-restricted-imports (C16): см. пояснение в health.module.ts — `@/` не резолвится
// нативным Node ESM в выводе `tsc`/`nest build` без bundler-шага (`assumptions` DTJ-001).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится нативным Node ESM в эмитированном tsc/nest build без bundler-шага (assumptions DTJ-001); относительный путь — единственный рабочий вариант без новых зависимостей.
import { AppConfigService } from '../../config/app-config.service.js'
import { toReadableMessage } from './error-message.util.js'

const REDIS_HEALTH_KEY = 'redis'
/** ASSUMPTION (DTJ-001): SRS-NFR-037 не фиксирует таймаут для Redis PING — переиспользуем
 * порог Postgres (2с, SRS-NFR-037) ради единообразного бюджета readiness-ответа. */
const REDIS_HEALTH_TIMEOUT_MS = 2000
const REDIS_HEALTH_MAX_RETRIES_PER_REQUEST = 1

/**
 * SRS-NFR-037: `RedisHealthIndicator` — `PING`. Минимальный DI-провайдер поверх `ioredis`
 * (DTJ-001, шаг 6), только для readiness-проб — не общий клиент приложения.
 */
@Injectable()
export class RedisReadinessIndicator implements OnModuleDestroy {
  private readonly client: Redis

  // Явный @Inject на обоих параметрах: esbuild (vitest) не эмитит `design:paramtypes`,
  // без него DI отказывает в тестах — не косметика, см. общий комментарий в DTJ-001.
  constructor(
    @Inject(AppConfigService) config: AppConfigService,
    @Inject(HealthIndicatorService) private readonly healthIndicatorService: HealthIndicatorService,
  ) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      commandTimeout: REDIS_HEALTH_TIMEOUT_MS,
      maxRetriesPerRequest: REDIS_HEALTH_MAX_RETRIES_PER_REQUEST,
    })
    // Без обработчика 'error' необработанное событие ioredis валит процесс; реальная
    // обработка ошибки — синхронно через reject промиса `ping()` в `check()` ниже (C12).
    this.client.on('error', () => undefined)
  }

  async check(): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(REDIS_HEALTH_KEY)
    try {
      await this.client.ping()
      return indicator.up()
    } catch (error) {
      return indicator.down({ message: toReadableMessage(error) })
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }
}
