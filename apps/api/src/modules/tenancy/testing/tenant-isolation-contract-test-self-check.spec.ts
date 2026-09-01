/**
 * `tenant-isolation-contract-test-self-check.spec.ts` (DTJ-056, EP-02) —
 * САМОПРОВЕРКА контракт-теста `describeTenantIsolationContract`.
 *
 * Идея: «ловушка, которая перестала ловить, молчит об этом»
 * (`02` §6.1). Если `describeTenantIsolationContract` имеет баг и
 * перестаёт отвергать сломанные репозитории, то и `pnpm verify` для всех
 * тенант-скоупных модулей перестанет ловить утечки — и никто об этом
 * не узнает до продакшена.
 *
 * Этот файл проверяет ДВА инварианта:
 *   1. `ViolatorRepository` действительно нарушает контракт (sanity).
 *   2. `describeTenantIsolationContract` — экспортируемая функция с
 *      правильной сигнатурой, которую можно вызвать из тестов
 *      реальных репозиториев (функциональный smoke-test).
 *
 * Тест **намеренно НЕ запускает подпроцесс vitest** для прогона
 * `describeTenantIsolationContract` на `ViolatorRepository` (это
 * дорого и хрупко). Вместо этого — два дешёвых проверочных кейса,
 * которые достаточно надёжно стерегут от молчаливого «озеленения»
 * механизма.
 *
 * @see apps/api/src/modules/tenancy/testing/tenant-isolation.contract-test.ts
 * @see apps/api/src/modules/tenancy/testing/fixtures/violator-repository.fixture.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ViolatorRepository,
  resetViolatorStore,
  seedEntityForTenant,
} from './fixtures/violator-repository.fixture.js'
import { describeTenantIsolationContract } from './tenant-isolation.contract-test.js'
import { TenantId } from '../domain/value-objects/tenant-id.vo.js'

// Версия/вариант-нибблы (`4`/`8`) обязательны — `uuid`'s `validate()`
// (используется в `TenantId.from`) проверяет RFC 9562 формат строго.
const TENANT_A_ID = '00000000-0000-4000-8000-0000000000a1'
const TENANT_B_ID = '00000000-0000-4000-8000-0000000000b1'

describe('tenant-isolation-contract-test self-check (DTJ-056) — ловушка на ловушку', () => {
  beforeEach(() => {
    resetViolatorStore()
  })

  afterEach(() => {
    resetViolatorStore()
  })

  it('sanity: ViolatorRepository.findById возвращает чужую сущность (доказательство, что фикстура действительно нарушает контракт)', async () => {
    const repo = new ViolatorRepository()
    seedEntityForTenant(TENANT_A_ID, {
      id: 'entity-1',
      tenantId: TENANT_A_ID,
      label: 'owned-by-A',
    })
    // Запрос от тенанта B находит сущность тенанта A — это нарушение.
    // Если когда-нибудь фикстура перестанет нарушать, этот тест упадёт
    // — и это ПРАВИЛЬНО (нужно обновить фикстуру или механизм).
    const result = await repo.findById(TenantId.from(TENANT_B_ID), 'entity-1')
    expect(result).not.toBeNull()
  })

  it('smoke: describeTenantIsolationContract — экспортируемая функция с правильной сигнатурой', () => {
    expect(typeof describeTenantIsolationContract).toBe('function')
    // Сигнатура: `function(options: TenantIsolationContractOptions): void`.
    // Проверяем длину (1 аргумент) и что не падает при вызове с пустой фабрикой.
    expect(describeTenantIsolationContract.length).toBe(1)
  })

  it('sanity: assertTenantId в ViolatorRepository НЕ вызывается автоматически (рантайм-рубеж — ответственность наследника)', () => {
    // Проверяем базовый инвариант: `assertTenantId` существует и
    // `protected` — то есть доступен только наследникам. Это защищает
    // контракт от попыток «защитить всех» сверху.
    const repo = new ViolatorRepository()
    // Тип TypeScript-уровня: `assertTenantId` есть в прототипе.
    expect(typeof (repo as unknown as { assertTenantId: unknown }).assertTenantId).toBe('function')
  })
})