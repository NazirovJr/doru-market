/**
 * Доменное событие `TenantBrandingUpdatedEvent` (DTJ-053). Публикуется при
 * изменении брендинга тенанта (DTJ-059), обработчик в `infrastructure` инвалидирует
 * кэш резолвинга (ключи `tenant:by-domain:*`/`tenant:by-slug:*` для данного тенанта).
 *
 * Прямой вызов `cache.invalidate*()` из use case допустим как временное упрощение
 * (DTJ-053 риск 1) до готовности общего outbox-релея EP-16.
 */
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export interface TenantBrandingUpdatedEvent {
  readonly tenantId: TenantId
  readonly occurredAt: Date
  readonly updatedFields: readonly string[]
}
