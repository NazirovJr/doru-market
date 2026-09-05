import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { AppConfigModule } from './config/config.module.js'
import { LoggerModule } from './common/logging/logger.module.js'
import { HttpLoggerMiddleware } from './common/logging/http-logger.middleware.js'
import { HealthModule } from './common/health/health.module.js'
import { RequestContextMiddleware } from './common/context/request-context.js'
import { DatabaseModule } from './infrastructure/database/database.module.js'
import { RedisModule } from './infrastructure/redis/redis.module.js'
import { SharedKernelModule } from './shared-kernel/shared-kernel.module.js'
import { TenancyModule } from './modules/tenancy/tenancy.module.js'
import { TenantResolutionMiddleware } from './modules/tenancy/presentation/middleware/tenant-resolution.middleware.js'
import { OnboardingModule } from './modules/onboarding/onboarding.module.js'
import { CatalogModule } from './modules/catalog/catalog.module.js'
import { InventoryModule } from './modules/inventory/inventory.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { OrdersModule } from './modules/orders/orders.module.js'
import { PaymentsModule } from './modules/payments/payments.module.js'
import { ReturnsModule } from './modules/returns/returns.module.js'
import { SupportModule } from './modules/support/support.module.js'
import { ResponseInterceptor } from './common/http/interceptors/response.interceptor.js'
import { OpenApiModule } from './common/openapi/openapi.module.js'
import { IdempotencyModule } from './common/idempotency/idempotency.module.js'

/**
 * Корневой модуль `apps/api` (DTJ-001, шаг 10). Barrel-файл (D-27) — правится ТОЛЬКО
 * добавлением строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * `imports` ниже — фундамент волны 1 (DTJ-001). Каждый следующий эпик добавляет СВОЙ
 * `modules/<context>Module` в этот массив ДОБАВЛЕНИЕМ строки, не трогая инфраструктурные
 * модули выше (`AppConfigModule`/`LoggerModule`/`HealthModule`) и не переписывая файл.
 *
 * **Глобальные фильтры (DTJ-018, SRS-API-016):** здесь их НЕТ. Единственный фильтр
 * приложения — `AllExceptionsFilter`, он регистрируется через `app.useGlobalFilters()`
 * в `main.ts`. Раньше в этом массиве стояли ещё `DomainExceptionFilter` и
 * `TransportExceptionFilter`, и оба были НЕДОСТИЖИМЫ: NestJS отдаёт исключение первому
 * подходящему фильтру, и им всегда оказывался зарегистрированный в `main.ts`. Их юнит-тесты
 * при этом были зелёными и описывали поведение, которого не видел ни один клиент.
 * Сняты с регистрации в волне 6 — см. JSDoc `common/filters/all-exceptions.filter.ts`.
 */
@Module({
  imports: [AppConfigModule, LoggerModule, HealthModule, DatabaseModule, RedisModule, SharedKernelModule, OpenApiModule, IdempotencyModule, TenancyModule, OnboardingModule, CatalogModule, InventoryModule, AuthModule, OrdersModule, PaymentsModule, ReturnsModule, SupportModule, ScheduleModule.forRoot()],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // ВАЖНО (риск тикета DTJ-001): порядок регистрации middleware ниже — часть контракта,
    // не переставлять. `RequestContextMiddleware` ОБЯЗАН выполняться ПЕРВЫМ — `requestId`
    // должен быть в `RequestContext` ДО `TenantResolutionMiddleware` (EP-02), иначе ошибки
    // резолвинга тенанта останутся без трассировки в логах. `HttpLoggerMiddleware` идёт
    // следующим, чтобы access-лог уже видел `requestId` через `mixin` корневого логгера.
    // `TenantResolutionMiddleware` (DTJ-054) — ПОСЛЕ `HttpLoggerMiddleware`, чтобы access-лог
    // уже мог видеть резолвленный `tenantId` (если запрос анонимный — `unresolved: technical`,
    // и это попадёт в лог). Регистрация по `'*'` (SRS-TEN-026): исключения для Telegram webhook
    // сделаны внутри самого middleware через `TENANT_RESOLUTION_EXCLUDED_PATHS` (DTJ-062).
    consumer
      .apply(RequestContextMiddleware, HttpLoggerMiddleware, TenantResolutionMiddleware)
      .forRoutes('*')
  }
}
