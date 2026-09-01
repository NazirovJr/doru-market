/**
 * Обработчик доменных событий брендинга/домена (DTJ-053). Подписан СИНХРОННО
 * после commit транзакции (SRS-TEN-005) — вызывает `cachePort.invalidate*()`.
 *
 * Прямой вызов из use case (минуя outbox) допустим как временное упрощение
 * (DTJ-053 риск 1): use case'ы DTJ-059/061 могут инжектировать этот handler
 * и вызывать его `handleBrandingUpdated()` / `handleDomainAttached()` после
 * `save()`. Параллельно остаётся подписка на outbox, когда EP-16 поставит
 * общий relay.
 *
 * Сейчас — заглушка-класс с методами, которые use case'ы вызывают напрямую.
 * Подписка на outbox-события добавится в отдельном тикете (когда общий
 * событийный мост будет готов).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { Logger } from 'pino'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import type { TenantCachePort } from '@/modules/tenancy/application/ports/tenant-cache.port.js'
import { TENANT_CACHE } from '@/modules/tenancy/application/ports/tenant-cache.port.js'
import type { TenantRepositoryPort } from '@/modules/tenancy/application/ports/tenant-repository.port.js'
import { TENANT_REPOSITORY } from '@/modules/tenancy/application/ports/tenant-repository.port.js'
import type { TenantBrandingUpdatedEvent } from '@/modules/tenancy/application/events/tenant-branding-updated.event.js'
import type { TenantDomainAttachedEvent } from '@/modules/tenancy/application/events/tenant-domain-attached.event.js'

@Injectable()
export class TenantCacheInvalidationHandler implements OnModuleInit {
  constructor(
    @Inject(TENANT_CACHE) private readonly cache: TenantCachePort,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepo: TenantRepositoryPort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    // TODO(EP-16): подписка на outbox-события через общий событийный мост.
    // Пока — прямой вызов из use case'ов DTJ-059/061.
  }

  async handleBrandingUpdated(event: TenantBrandingUpdatedEvent): Promise<void> {
    // Инвалидируем slug — даже если менялся только палитра, устаревать может
    // и общий `tenant:by-slug:*` (на случай будущих embed-страниц).
    const tenant = await this.tenantRepo.findById(event.tenantId)
    if (tenant === null) {
      this.logger.warn({ tenantId: event.tenantId.value }, 'branding_updated_tenant_not_found')
      return
    }
    await this.cache.invalidateSlug(tenant.slug.value)
    if (tenant.customDomain !== null) {
      await this.cache.invalidateDomain(tenant.customDomain)
    }
  }

  async handleDomainAttached(event: TenantDomainAttachedEvent): Promise<void> {
    const tenant = await this.tenantRepo.findById(event.tenantId)
    if (tenant === null) {
      this.logger.warn({ tenantId: event.tenantId.value }, 'domain_attached_tenant_not_found')
      return
    }
    // Согласно SRS-TEN-035: при `pending_verification` домен НЕ должен резолвиться.
    // Поэтому инвалидируем оба ключа, чтобы случайно устаревший `verified`-записи
    // не подменили новый `pending`.
    await this.cache.invalidateDomain(event.domain)
    await this.cache.invalidateSlug(tenant.slug.value)
  }
}
