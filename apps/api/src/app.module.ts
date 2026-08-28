import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { AppConfigModule } from './config/config.module.js'
import { LoggerModule } from './common/logging/logger.module.js'
import { HttpLoggerMiddleware } from './common/logging/http-logger.middleware.js'
import { HealthModule } from './common/health/health.module.js'
import { RequestContextMiddleware } from './common/context/request-context.js'

/**
 * Корневой модуль `apps/api` (DTJ-001, шаг 10). Barrel-файл (D-27) — правится ТОЛЬКО
 * добавлением строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * `imports` ниже — фундамент волны 1 (DTJ-001). Каждый следующий эпик добавляет СВОЙ
 * `modules/<context>Module` в этот массив ДОБАВЛЕНИЕМ строки, не трогая инфраструктурные
 * модули выше (`AppConfigModule`/`LoggerModule`/`HealthModule`) и не переписывая файл.
 */
@Module({
  imports: [AppConfigModule, LoggerModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // ВАЖНО (риск тикета DTJ-001): порядок регистрации middleware ниже — часть контракта,
    // не переставлять. `RequestContextMiddleware` ОБЯЗАН выполняться ПЕРВЫМ — `requestId`
    // должен быть в `RequestContext` ДО `TenantResolutionMiddleware` (EP-02), иначе ошибки
    // резолвинга тенанта останутся без трассировки в логах. `HttpLoggerMiddleware` идёт
    // следующим, чтобы access-лог уже видел `requestId` через `mixin` корневого логгера.
    // EP-02 добавляет `TenantResolutionMiddleware` СТРОГО ПОСЛЕ этих двух строк.
    consumer.apply(RequestContextMiddleware, HttpLoggerMiddleware).forRoutes('*')
  }
}
