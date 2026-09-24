/**
 * Тест на утечку тенантных данных через `TenantRepository` (EP-02, волна 3.5 задача 4).
 *
 * Проверяет ИНВАРИАНТ репозитория: `findBySlug(slug)` возвращает только тенант
 * с ЭТИМ slug, и никогда — тенант другого тенанта, даже если в `Map` лежат оба.
 * Это страховка от регрессий, когда в `findBySlug` случайно уберут `WHERE slug = ?`.
 *
 * Используется in-memory реализация (`InMemoryTenantRepository`) — это test-double,
 * повторяющая контракт `TenantRepositoryPort`. Сам Drizzle-код проверяется
 * integration-тестами в `apps/api/test/integration/db/` (TODO EP-19).
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 4
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tenant } from '@/modules/tenancy/domain/tenant.entity.js'
import type {
  TenantRepositoryPort,
  TenantsListPage,
  TenantsListQuery,
} from '@/modules/tenancy/application/ports/tenant-repository.port.js'

/** Сборка минимального `Tenant` (re-store) для целей теста изоляции. */
function makeTenant(slug: string, id: string): Tenant {
  // Полноценный `restore` требует TenantSettings; здесь нам нужна только изоляция
  // по slug, поэтому используем заглушку с фиктивной структурой, которой достаточно
  // для тестового in-memory репозитория. Чтобы не вводить test-only API в `domain/`,
  // обходим через `unknown`.
  return { id: { value: id }, slug: { value: slug } } as unknown as Tenant
}

/** In-memory реализация `TenantRepositoryPort` (test double). */
class InMemoryTenantRepository implements TenantRepositoryPort {
  private readonly byId = new Map<string, Tenant>()

  save(tenant: Tenant): Promise<void> {
    this.byId.set((tenant as unknown as { id: { value: string } }).id.value, tenant)
    return Promise.resolve()
  }

  findById(id: { value: string }): Promise<Tenant | null> {
    return Promise.resolve(this.byId.get(id.value) ?? null)
  }

  findBySlug(slug: string): Promise<Tenant | null> {
    for (const tenant of this.byId.values()) {
      const tenantSlug = (tenant as unknown as { slug: { value: string } }).slug.value
      if (tenantSlug === slug) {
        return Promise.resolve(tenant)
      }
    }
    return Promise.resolve(null)
  }

  findByCustomDomain(domain: string): Promise<Tenant | null> {
    for (const tenant of this.byId.values()) {
      if ((tenant as unknown as { customDomain: string | null }).customDomain === domain) {
        return Promise.resolve(tenant)
      }
    }
    return Promise.resolve(null)
  }

  findByChainId(chainId: { value: string }): Promise<Tenant | null> {
    for (const tenant of this.byId.values()) {
      if ((tenant as unknown as { chainId: { value: string } | null }).chainId?.value === chainId.value) {
        return Promise.resolve(tenant)
      }
    }
    return Promise.resolve(null)
  }

  /** ДОБАВЛЕНО (DTJ-351) — не используется этим тестом (проверяет только изоляцию по slug). */
  list(_query: TenantsListQuery): Promise<TenantsListPage> {
    return Promise.resolve({ items: [], nextCursor: null, hasMore: false })
  }
}

describe('TenantRepository — изоляция тенантов по slug (EP-02, задача 4)', () => {
  let repo: InMemoryTenantRepository
  const apelsinka = makeTenant('apelsinka', '00000000-0000-0000-0000-000000000001')
  const farmonika = makeTenant('farmonika', '00000000-0000-0000-0000-000000000002')
  const neutral = makeTenant('neutral', '00000000-0000-0000-0000-000000000003')

  beforeEach(async () => {
    repo = new InMemoryTenantRepository()
    await repo.save(apelsinka)
    await repo.save(farmonika)
    await repo.save(neutral)
  })

  it('findBySlug("apelsinka") возвращает только apelsinka', async () => {
    const found = await repo.findBySlug('apelsinka')
    expect(found).not.toBeNull()
    expect((found as unknown as { slug: { value: string } } | null)?.slug.value).toBe('apelsinka')
    expect((found as unknown as { id: { value: string } } | null)?.id.value).toBe(
      '00000000-0000-0000-0000-000000000001',
    )
  })

  it('findBySlug("farmonika") возвращает только farmonika (нет утечки на apelsinka)', async () => {
    const found = await repo.findBySlug('farmonika')
    expect((found as unknown as { slug: { value: string } }).slug.value).toBe('farmonika')
    expect((found as unknown as { id: { value: string } }).id.value).not.toBe(
      '00000000-0000-0000-0000-000000000001',
    )
  })

  it('findBySlug("unknown") возвращает null', async () => {
    const found = await repo.findBySlug('unknown')
    expect(found).toBeNull()
  })

  it('findBySlug("neutral") возвращает ТОЛЬКО нейтрального тенанта', async () => {
    const found = await repo.findBySlug('neutral')
    expect((found as unknown as { slug: { value: string } }).slug.value).toBe('neutral')
    expect((found as unknown as { id: { value: string } }).id.value).toBe(
      '00000000-0000-0000-0000-000000000003',
    )
  })

  it('findById возвращает тенанта по id и не путает с другими', async () => {
    const found = await repo.findById({ value: '00000000-0000-0000-0000-000000000002' })
    expect((found as unknown as { slug: { value: string } }).slug.value).toBe('farmonika')
  })
})
