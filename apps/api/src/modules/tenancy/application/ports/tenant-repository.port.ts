/**
 * `TenantRepositoryPort` (DTJ-052) — application-уровень контракта доступа к
 * агрегату `Tenant`. Содержит поиск по 4 ключам, используемым резолвингом
 * (DTJ-054) и use case'ами (DTJ-057/059/061/062), плюс `save` (upsert).
 *
 * `tenants` НЕ наследует `TenantScopedRepository` (DTJ-056) — сама таблица
 * определяет тенантов, тенант-скоуп неприменим по определению. Явный
 * комментарий оставлен в `infrastructure/repositories/tenant.repository.ts`.
 */
import type { Tenant } from '../../domain/tenant.entity.js'
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export const TENANT_REPOSITORY = Symbol.for('@dorutj/tenancy/tenant-repository')

export interface TenantRepositoryPort {
  findById(id: TenantId): Promise<Tenant | null>
  findBySlug(slug: string): Promise<Tenant | null>
  findByCustomDomain(domain: string): Promise<Tenant | null>
  findByChainId(chainId: TenantId): Promise<Tenant | null>
  save(tenant: Tenant): Promise<void>
}
