import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvConfig } from './env.schema.js'

const LOG_LEVEL_PRODUCTION_DEFAULT = 'info'
const LOG_LEVEL_DEVELOPMENT_DEFAULT = 'debug'

/**
 * Типизированный фасад над `ConfigService<EnvConfig, true>` (DTJ-001, шаг 3). Единственное
 * место, где ENV читается напрямую — остальной код инжектирует этот сервис, а не
 * `ConfigService`/`process.env` (домен и application вообще не видят ни того, ни другого).
 */
@Injectable()
export class AppConfigService {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001.
  constructor(@Inject(ConfigService) private readonly configService: ConfigService<EnvConfig, true>) {}

  get nodeEnv(): EnvConfig['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true })
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development'
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true })
  }

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true })
  }

  get redisUrl(): string {
    return this.configService.get('REDIS_URL', { infer: true })
  }

  get requestTimeoutMs(): number {
    return this.configService.get('REQUEST_TIMEOUT_MS', { infer: true })
  }

  /** SRS-NFR-038/pino: `info` в проде, `debug` в остальных окружениях, если ENV не задан явно. */
  get logLevel(): NonNullable<EnvConfig['LOG_LEVEL']> {
    const configured = this.configService.get('LOG_LEVEL', { infer: true })
    return configured ?? (this.isProduction ? LOG_LEVEL_PRODUCTION_DEFAULT : LOG_LEVEL_DEVELOPMENT_DEFAULT)
  }

  /** SRS-API-065: `CORS_STATIC_ORIGINS` — CSV в ENV, здесь уже разобран в список. */
  get corsStaticOrigins(): readonly string[] {
    return this.configService
      .get('CORS_STATIC_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  }
}
