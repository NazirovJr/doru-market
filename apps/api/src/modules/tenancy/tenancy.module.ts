/**
 * NestJS-модуль `tenancy` (DTJ-050, каркас; DTJ-052..053 — репозитории, кэш).
 * Barrel-файл (D-27) — правится ТОЛЬКО добавлением строк.
 */
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { DrizzleTenantRepository } from './infrastructure/repositories/tenant.repository.js'
import { DrizzleTenantSettingsRepository } from './infrastructure/repositories/tenant-settings.repository.js'
import { RedisTenantCacheAdapter } from './infrastructure/adapters/tenant-cache.adapter.js'
import { TenantCacheInvalidationHandler } from './infrastructure/events/tenant-cache-invalidation.handler.js'
import { TenantResolutionMiddleware } from './presentation/middleware/tenant-resolution.middleware.js'
import { TenantScopeGuard } from '@/common/guards/tenant-scope.guard.js'
import {
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
} from './application/ports/tenant-repository.port.js'
import {
  TENANT_SETTINGS_REPOSITORY,
  type TenantSettingsRepositoryPort,
} from './application/ports/tenant-settings-repository.port.js'
import { TENANT_CACHE, type TenantCachePort } from './application/ports/tenant-cache.port.js'

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: DrizzleTenantRepository },
    { provide: TENANT_SETTINGS_REPOSITORY, useClass: DrizzleTenantSettingsRepository },
    { provide: TENANT_CACHE, useClass: RedisTenantCacheAdapter },
    DrizzleTenantRepository,
    DrizzleTenantSettingsRepository,
    RedisTenantCacheAdapter,
    TenantCacheInvalidationHandler,
    TenantResolutionMiddleware,
    // Глобальный guard: проверяет, что `TenantResolutionMiddleware` оставил
    // резолвленный тенант в `TenantContext` (DTJ-055). `APP_GUARD` — единственный
    // поддерживаемый NestJS способ зарегистрировать guard на ВСЕ маршруты разом
    // без необходимости перечислять модули здесь.
    { provide: APP_GUARD, useClass: TenantScopeGuard },
  ],
  exports: [TENANT_REPOSITORY, TENANT_SETTINGS_REPOSITORY, TENANT_CACHE, TenantCacheInvalidationHandler, TenantResolutionMiddleware],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class TenancyModule {}

export type { TenantRepositoryPort, TenantSettingsRepositoryPort, TenantCachePort }
