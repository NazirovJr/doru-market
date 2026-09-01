/**
 * `describeTenantIsolationContract` (DTJ-056, EP-02) — переиспользуемый
 * поведенческий контракт-тест для тенант-скоупных репозиториев.
 *
 * Зачем
 * -----
 * Charter §3.4 требует «обязателен тест на утечку данных между тенантами».
 * Эта функция — ЕДИНСТВЕННОЕ место, где живёт сам механизм проверки
 * (не реализация конкретного модуля). Каждый тенант-скоупный репозиторий
 * (`orders`, `prescriptions`, `cart`, `notifications`, `users`,
 * `i18n_overrides`) параметризует эту функцию своим репозиторием; это
 * единственный способ гарантировать, что репозиторий НЕ возвращает
 * сущность чужого тенанта при запросе от чужого `tenantId`.
 *
 * Как использовать
 * ----------------
 * В `apps/api/src/modules/<модуль>/infrastructure/repositories/<x>.contract-test.spec.ts`:
 *
 * ```ts
 * import { describeTenantIsolationContract } from '@/modules/tenancy'
 * import { OrdersRepository } from './orders.repository.js'
 *
 * describeTenantIsolationContract({
 *   repositoryFactory: () => new OrdersRepository(testDb),
 *   seedEntity: async (tenantId) => {
 *     const id = crypto.randomUUID()
 *     await testDb.insert(orders).values({ id, tenantId: tenantId.value, ... })
 *     return { entityId: id }
 *   },
 *   findById: (repo, tenantId, entityId) => repo.findById(tenantId, entityId),
 * })
 * ```
 *
 * Контракт проверяет 3 инварианта:
 *   1. Изоляция: запрос от имени тенанта B НЕ находит сущность тенанта A.
 *   2. Положительный путь: запрос от имени «своего» тенанта сущность
 *      находит (страховка от обратного — false positive на пустой БД).
 *   3. Стабильность: повторный запрос не «протекает» из-за глобального
 *      кэша или singleton-состояния.
 *
 * Ловушка на ловушку
 * ------------------
 * Чтобы убедиться, что сам контракт-тест РЕАЛЬНО ловит нарушение, существует
 * `tenant-isolation-contract-test-self-check.spec.ts` — он запускает
 * `describeTenantIsolationContract` против `ViolatorRepository` (фикстура
 * намеренно сломанного репозитория) и проверяет, что хотя бы один сценарий
 * ПАДАЕТ. Если этот self-check стал зелёным — значит, контракт-тест
 * сломался и больше не защищает от утечек. Это «ловушка, которая перестала
 * ловить, молчит об этом» из `02` §6.1.
 *
 * @see apps/api/src/modules/tenancy/testing/fixtures/violator-repository.fixture.ts
 * @see apps/api/src/modules/tenancy/infrastructure/base/tenant-scoped-repository.ts
 */
import { describe, expect, it } from 'vitest'
import { TenantId } from '../domain/value-objects/tenant-id.vo.js'
import type { TenantScopedRepository } from '../infrastructure/base/tenant-scoped-repository.js'

/**
 * Опции контракт-теста. Все три поля обязательны — нельзя тестировать
 * изоляцию через «пустой» репозиторий, это дыра в проверке.
 */
export interface TenantIsolationContractOptions<TRepo extends TenantScopedRepository<unknown>> {
  /**
   * Фабрика экземпляра репозитория. Вызывается для каждого `it`-кейса
   * отдельно (изоляция состояния между кейсами). Может возвращать
   * свежий in-memory или настоящий Drizzle-репозиторий.
   */
  readonly repositoryFactory: () => TRepo

  /**
   * Создаёт сущность в указанном тенанте, возвращает её `entityId`.
   * Контракт-тест использует это для setup двух тенантов (A и B) и
   * последующего запроса «чужой» сущности.
   */
  readonly seedEntity: (tenantId: TenantId) => Promise<{ readonly entityId: string }>

  /**
   * Чтение сущности через репозиторий — обёртка, потому что у разных
   * репозиториев разные сигнатуры `findById` (где-то `(id) => Promise<T | null>`,
   * где-то `(tenantId, id) => Promise<T | null>`). Контракт-тест
   * вызывает это с «правильным» тенантом, и должен получить сущность
   * или `null` в зависимости от сценария.
   */
  readonly findById: (repo: TRepo, tenantId: TenantId, entityId: string) => Promise<unknown>
}

/**
 * `describeTenantIsolationContract` — функция-параметризатор, которую
 * каждый тенант-скоупный репозиторий вызывает в своём `.contract-test.spec.ts`.
 * Использует `describe.each`-паттерн через явный `describe` с под-блоками,
 * потому что Vitest `describe.each` не поддерживает async-фабрику входов.
 */
export function describeTenantIsolationContract<TRepo extends TenantScopedRepository<unknown>>(
  options: TenantIsolationContractOptions<TRepo>,
): void {
  // Используем factory-сигнатуру, чтобы описать кейсы декларативно.
  describe('TenantIsolationContract (DTJ-056) — изоляция тенантов', () => {
    const TENANT_A_ID = '00000000-0000-0000-0000-0000000000a1'
    const TENANT_B_ID = '00000000-0000-0000-0000-0000000000b1'

    // Динамический импорт для tenant-id-фабрики, чтобы тест не зависел от
    // глобального состояния vitest-runner.
    const tenantA = TenantId.from(TENANT_A_ID)
    const tenantB = TenantId.from(TENANT_B_ID)

    it('изоляция: запрос от тенанта B НЕ возвращает сущность тенанта A', async () => {
      const repo = options.repositoryFactory()
      const { entityId } = await options.seedEntity(tenantA)
      const result = await options.findById(repo, tenantB, entityId)
      expect(result).toBeNull()
    })

    it('положительный путь: запрос от тенанта A возвращает свою сущность (страховка от false positive)', async () => {
      const repo = options.repositoryFactory()
      const { entityId } = await options.seedEntity(tenantA)
      const result = await options.findById(repo, tenantA, entityId)
      expect(result).not.toBeNull()
    })

    it('стабильность: повторные запросы от тенанта B не начинают «протекать» из-за глобального кэша', async () => {
      const repo = options.repositoryFactory()
      const { entityId } = await options.seedEntity(tenantA)
      // 3 последовательных запроса: первый и третий должны быть null,
      // второй — вызов из другой локации, проверяет стабильность.
      expect(await options.findById(repo, tenantB, entityId)).toBeNull()
      expect(await options.findById(repo, tenantB, entityId)).toBeNull()
      expect(await options.findById(repo, tenantB, entityId)).toBeNull()
    })
  })
}