import { Global, Module } from '@nestjs/common'
// no-restricted-imports (C16): см. пояснение в common/health/health.module.ts — `@/` не
// резолвится нативным Node ESM в выводе `tsc`/`nest build` без bundler-шага
// (`assumptions` DTJ-001).
// eslint-disable-next-line no-restricted-imports
import { AppConfigModule } from '../../config/config.module.js'
// eslint-disable-next-line no-restricted-imports
import { AppConfigService } from '../../config/app-config.service.js'
import { PINO_LOGGER } from './pino-logger.token.js'
import { createRootLogger } from './root-logger.js'
import { HttpLoggerMiddleware } from './http-logger.middleware.js'

/**
 * DTJ-001, шаг 5: единый pino-логгер процесса + access-лог middleware. `@Global()` —
 * `PINO_LOGGER` доступен любому будущему `modules/<context>` без повторного импорта.
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    { provide: PINO_LOGGER, useFactory: createRootLogger, inject: [AppConfigService] },
    HttpLoggerMiddleware,
  ],
  exports: [PINO_LOGGER, HttpLoggerMiddleware],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class LoggerModule {}
