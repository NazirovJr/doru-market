import { Inject, Injectable } from '@nestjs/common'
import type { TenantBrandingChange, TenantEventPublisherPort } from '@/modules/tenancy/application/ports/tenant-event-publisher.port.js'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { TenantCacheInvalidationHandler } from './tenant-cache-invalidation.handler.js'

// Прямой вызов, а не outbox: инвалидация кэша резолвинга должна пройти до ответа на PUT.
@Injectable()
export class InProcessTenantEventPublisher implements TenantEventPublisherPort {
  constructor(
    @Inject(TenantCacheInvalidationHandler) private readonly invalidation: TenantCacheInvalidationHandler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  publishBrandingUpdated(change: TenantBrandingChange): Promise<void> {
    return this.invalidation.handleBrandingUpdated({ ...change, occurredAt: this.clock.now() })
  }
}
