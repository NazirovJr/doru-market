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

export interface TenantsListCursor {
  readonly v: string
  readonly id: string
}

export interface TenantsListQuery {
  readonly limit: number
  readonly cursor?: TenantsListCursor | null
}

// createdAt отдельно от Tenant — домен этого поля не несёт.
export interface TenantListItem {
  readonly tenant: Tenant
  readonly createdAt: Date
}

export interface TenantsListPage {
  readonly items: readonly TenantListItem[]
  readonly nextCursor: TenantsListCursor | null
  readonly hasMore: boolean
}

export interface TenantRepositoryPort {
  findById(id: TenantId): Promise<Tenant | null>
  findBySlug(slug: string): Promise<Tenant | null>
  findByCustomDomain(domain: string): Promise<Tenant | null>
  findByChainId(chainId: TenantId): Promise<Tenant | null>
  list(query: TenantsListQuery): Promise<TenantsListPage>
  save(tenant: Tenant): Promise<void>
}
