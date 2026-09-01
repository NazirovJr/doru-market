/**
 * Redis-реализация `TenantCachePort` (DTJ-053).
 *
 * Ключи:
 *   - `tenant:by-domain:{host}` → tenantId (UUID-строка)
 *   - `tenant:by-slug:{slug}` → tenantId
 *
 * TTL — `TENANT_DOMAIN_CACHE_TTL_SECONDS` (ASSUMPTION 60, SRS-TEN-005).
 * Подстраховка, не основной механизм: основной — инвалидация по событиям
 * (SRS-TEN-005, `tenant-branding-updated.event.ts` / `tenant-domain-attached.event.ts`).
 *
 * Graceful degradation (SRS-TEN-006): ЛЮБАЯ ошибка Redis (ECONNREFUSED, OOM, etc.)
 * логируется `pino.warn` и возвращается как `null` (имитация промаха кэша).
 * Это сознательное отличие от «промаха» (`null` без лога): middleware DTJ-054
 * единообразно идёт в `TenantRepository`, а `pino.warn` остаётся как сигнал
 * деградации (но НЕ как `error` — это ожидаемый путь, не паника).
 */
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import type { Logger } from 'pino'
import { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import type { TenantCachePort } from '@/modules/tenancy/application/ports/tenant-cache.port.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

/** ASSUMPTION: TTL кэша резолвинга тенанта, SRS-TEN-005. */
export const TENANT_DOMAIN_CACHE_TTL_SECONDS = 60

@Injectable()
export class RedisTenantCacheAdapter implements TenantCachePort {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async getByDomain(host: string): Promise<TenantId | null> {
    return this.getByKey(`tenant:by-domain:${host.toLowerCase()}`)
  }

  async getBySlug(slug: string): Promise<TenantId | null> {
    return this.getByKey(`tenant:by-slug:${slug.toLowerCase()}`)
  }

  async setByDomain(host: string, tenantId: TenantId): Promise<void> {
    await this.setByKey(`tenant:by-domain:${host.toLowerCase()}`, tenantId)
  }

  async setBySlug(slug: string, tenantId: TenantId): Promise<void> {
    await this.setByKey(`tenant:by-slug:${slug.toLowerCase()}`, tenantId)
  }

  async invalidateDomain(host: string): Promise<void> {
    await this.delKey(`tenant:by-domain:${host.toLowerCase()}`)
  }

  async invalidateSlug(slug: string): Promise<void> {
    await this.delKey(`tenant:by-slug:${slug.toLowerCase()}`)
  }

  private async getByKey(key: string): Promise<TenantId | null> {
    try {
      const value = await this.redis.get(key)
      return value === null ? null : TenantId.from(value)
    } catch (error: unknown) {
      // Штатный промах кэша (`null`) НЕ логируется. Сбой соединения/Redis — логируется
      // как warn (SRS-TEN-006). Различить можно по типу ошибки: `ReplyError`/`Error` с
      // кодом ECONNREFUSED. Здесь упрощённо — логируем ВСЁ кроме `null`.
      this.logger.warn(
        { err: error, key },
        'tenant_cache_unavailable — degraded to repository lookup',
      )
      return null
    }
  }

  private async setByKey(key: string, tenantId: TenantId): Promise<void> {
    try {
      await this.redis.set(key, tenantId.value, 'EX', TENANT_DOMAIN_CACHE_TTL_SECONDS)
    } catch (error: unknown) {
      // Запись в кэш — оптимизация, не источник истины. Провал записи НЕ должен
      // блокировать запрос.
      this.logger.warn({ err: error, key }, 'tenant_cache_write_failed')
    }
  }

  private async delKey(key: string): Promise<void> {
    try {
      await this.redis.del(key)
    } catch (error: unknown) {
      this.logger.warn({ err: error, key }, 'tenant_cache_invalidate_failed')
    }
  }
}
