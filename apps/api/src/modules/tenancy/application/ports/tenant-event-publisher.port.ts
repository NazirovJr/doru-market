import type { TenantBrandingUpdatedEvent } from '../events/tenant-branding-updated.event.js'

export const TENANT_EVENT_PUBLISHER = Symbol.for('@dorutj/tenancy/tenant-event-publisher')

// Момент события проставляет публикатор (через Clock), вызывающий передаёт только суть изменения.
export type TenantBrandingChange = Omit<TenantBrandingUpdatedEvent, 'occurredAt'>

export interface TenantEventPublisherPort {
  publishBrandingUpdated(change: TenantBrandingChange): Promise<void>
}
