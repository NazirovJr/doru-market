/**
 * `TenantCachePort` (DTJ-053) — кэш резолвинга тенанта (Host/Slug → tenantId).
 * Backed by Redis в production (SRS-TEN-005), с graceful degradation при недоступности
 * (SRS-TEN-006): адаптер при сбое Redis возвращает `null` (имитация промаха кэша)
 * и логирует `pino.warn` — вызывающий код (middleware DTJ-054) единообразно идёт
 * в `TenantRepository`.
 */
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export const TENANT_CACHE = Symbol.for('@dorutj/tenancy/tenant-cache')

export interface TenantCachePort {
  getByDomain(host: string): Promise<TenantId | null>
  getBySlug(slug: string): Promise<TenantId | null>
  setByDomain(host: string, tenantId: TenantId): Promise<void>
  setBySlug(slug: string, tenantId: TenantId): Promise<void>
  invalidateDomain(host: string): Promise<void>
  invalidateSlug(slug: string): Promise<void>
}
