/**
 * `ViolatorRepository` (DTJ-056, EP-02) — НАМЕРЕННО НЕПРАВИЛЬНАЯ реализация
 * `TenantScopedRepository`. Используется в
 * `tenant-isolation-contract-test-self-check.spec.ts` как фикстура-доказательство:
 * контракт-тест `describeTenantIsolationContract` действительно ЛОВИТ
 * репозиторий, который игнорирует `tenantId` (фильтрует только по `id`).
 *
 * Если эта фикстура перестанет падать в тесте — значит, контракт-тест
 * сломался, и `pnpm verify` для всех тенант-скоупных репозиториев
 * молча проходит без проверки изоляции. Это «ловушка на ловушку» по
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1.
 *
 * НЕ ИСПОЛЬЗУЙТЕ эту фикстуру в продакшен-коде. Она существует ТОЛЬКО для
 * тестовой инфраструктуры.
 */
import { TenantScopedRepository } from '@/modules/tenancy/infrastructure/base/tenant-scoped-repository.js'
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'

interface DummyEntity {
  readonly id: string
  readonly tenantId: string
  readonly label: string
}

/**
 * Статическое in-memory хранилище фикстуры. Каждый тест ОБЯЗАН вызвать
 * `resetViolatorStore()` в `beforeEach` для изоляции.
 */
const STORE_ENTITIES = new Map<string, DummyEntity>()

/**
 * Помощник для тестов: засеять хранилище для конкретного тенанта.
 */
export function seedEntityForTenant(tenantId: string, entity: DummyEntity): void {
  const key = `${tenantId}::${entity.id}`
  STORE_ENTITIES.set(key, entity)
}

/**
 * Помощник для тестов: сбросить хранилище перед каждым кейсом.
 */
export function resetViolatorStore(): void {
  STORE_ENTITIES.clear()
}

/**
 * `ViolatorRepository extends TenantScopedRepository<DummyEntity>` — наследник
 * базового класса, реализующий методы намеренно неправильно: `findById`
 * игнорирует `tenantId`. Это «ловушка, которую ловушка должна поймать».
 */
export class ViolatorRepository extends TenantScopedRepository<DummyEntity> {
  /**
   * Не вызывает `assertTenantId` и фильтрует ТОЛЬКО по `id`. Возвращает
   * `null` для несуществующего, иначе — глобально найденную сущность (включая
   * чужие тенанты).
   */
  // findById возвращает Promise без await: тест проверяет, что фикстура
// действительно нарушает контракт (фильтрует только по id). async без
// await — намеренно упрощённая реализация; в продакшен-коде такая
// реализация была бы регрессом.
findById(tenantId: TenantId, id: string): Promise<DummyEntity | null> {
  // Намеренно НЕ вызываем this.assertTenantId(tenantId) — это часть нарушения:
  // хороший репозиторий ОБЯЗАН рантайм-проверить tenantId.
  void tenantId
  for (const entity of STORE_ENTITIES.values()) {
    if (entity.id === id) return Promise.resolve(entity)
  }
  return Promise.resolve(null)
}

save(tenantId: TenantId, entity: DummyEntity): Promise<void> {
  // Тоже «полусломанный»: сохраняет, но не использует tenantId явно.
  void tenantId
  STORE_ENTITIES.set(`${entity.tenantId}::${entity.id}`, entity)
  return Promise.resolve()
}
}