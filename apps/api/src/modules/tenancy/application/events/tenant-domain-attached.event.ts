/**
 * Доменное событие `TenantDomainAttachedEvent` (DTJ-053, DTJ-061). Публикуется
 * при привязке кастомного домена к тенанту (`AttachCustomDomainUseCase`).
 * Обработчик инвалидирует `tenant:by-slug:*` (slug не меняется, но на всякий
 * случай) и НЕ инвалидирует `tenant:by-domain:*` потому что новый домен ещё
 * не `verified` (SRS-TEN-035) — он не должен резолвиться до подтверждения.
 */
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export interface TenantDomainAttachedEvent {
  readonly tenantId: TenantId
  readonly domain: string
  readonly occurredAt: Date
}
