/**
 * Доменное событие `TenantProvisionedEvent` (DTJ-057, SRS-TEN-020). Публикуется
 * в `outbox` при успешном `ProvisionTenantUseCase.execute(...)` — будущий
 * consumer (audit/analytics) строит read-модели.
 *
 * Сейчас событие не имеет потребителей внутри EP-02, но контракт зафиксирован,
 * чтобы EP-04/EP-15 не изобретали свой формат.
 */
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export interface TenantProvisionedEvent {
  readonly tenantId: TenantId
  readonly chainId: TenantId
  readonly slug: string
  readonly brandName: string
  readonly occurredAt: Date
}
