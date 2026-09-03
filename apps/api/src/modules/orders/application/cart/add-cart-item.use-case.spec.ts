/**
 * Тест `AddCartItemUseCase` (EP-09, DTJ-223). Каждый кейс — один критерий приёмки тикета,
 * плюс тенант-изоляция (SRS-API-043/046, доработка по замечанию CTO).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError, ControlledSubstanceNotOrderableError } from '@dorutj/contracts'
import type { AppConfigService } from '@/config/app-config.service.js'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { FakeCatalogFacadePort } from '@/modules/orders/testing/fixtures/fake-catalog-facade-port.fixture.js'
import { FakeCartHoldStorePort } from '@/modules/orders/testing/fixtures/fake-cart-hold-store-port.fixture.js'
import { AddCartItemUseCase } from './add-cart-item.use-case.js'

const CART_HOLD_TTL_SECONDS_TEST = 900

/** Узкий стаб `AppConfigService` (тот же приём, что `request-otp.use-case.spec.ts`). */
class StubConfig {
  cartHoldTtlSeconds = CART_HOLD_TTL_SECONDS_TEST
}

const TENANT_ID = randomUUID()
const OTHER_TENANT_ID = randomUUID()
const CART_ID = randomUUID()
const MEDICINE_ID = randomUUID()
const OTHER_MEDICINE_ID = randomUUID()
const PHARMACY_ID = randomUUID()
const OTHER_PHARMACY_ID = randomUUID()

function setUp() {
  const cartRepository = new InMemoryCartRepository()
  cartRepository.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
  const catalogFacadePort = new FakeCatalogFacadePort()
  catalogFacadePort.setSnapshot({
    medicineId: MEDICINE_ID,
    tradeName: 'Медикамент А',
    unitPriceDiram: 1000n,
    isPrescriptionRequired: false,
    controlCategory: 'none',
  })
  const cartHoldStore = new FakeCartHoldStorePort()
  const useCase = new AddCartItemUseCase(
    cartRepository,
    catalogFacadePort,
    cartHoldStore,
    new StubConfig() as unknown as AppConfigService,
  )
  return { cartRepository, catalogFacadePort, cartHoldStore, useCase }
}

describe('AddCartItemUseCase', () => {
  it('AC1: дважды с тем же (medicineId, pharmacyId) и quantity=2 → одна строка с quantity=4', async () => {
    const { cartRepository, useCase } = setUp()

    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 2,
    })
    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 2,
    })

    const items = await cartRepository.findItemsByCartId(TENANT_ID, CART_ID)
    expect(items).toHaveLength(1)
    expect(items[0]?.quantity).toBe(4)
  })

  it('DTJ-224: успешное добавление ставит мягкий Redis-холд СУММАРНЫМ количеством строки (не дельтой)', async () => {
    const { cartHoldStore, useCase } = setUp()

    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 2,
    })
    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 2,
    })

    expect(cartHoldStore.holdCalls).toHaveLength(2)
    expect(cartHoldStore.holdCalls[0]).toMatchObject({
      pharmacyId: PHARMACY_ID,
      medicineId: MEDICINE_ID,
      quantity: 2,
      ttlSeconds: CART_HOLD_TTL_SECONDS_TEST,
    })
    // Второй вызов — количество ПОСЛЕ upsert (4), не дельта (2): `hold` перезаписывает значение по ключу.
    expect(cartHoldStore.holdCalls[1]).toMatchObject({ quantity: 4, ttlSeconds: CART_HOLD_TTL_SECONDS_TEST })
  })

  it('DTJ-224: запрещённая категория (psychotropic) НЕ ставит холд — строка не создана', async () => {
    const { cartHoldStore, catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSnapshot({
      medicineId: MEDICINE_ID,
      unitPriceDiram: 1000n,
      isPrescriptionRequired: false,
      controlCategory: 'psychotropic',
    })

    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    expect(cartHoldStore.holdCalls).toHaveLength(0)
  })

  it('AC2: controlCategory=psychotropic → Err(ControlledSubstanceNotOrderableError), строка не создана', async () => {
    const { cartRepository, catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSnapshot({
      medicineId: MEDICINE_ID,
      unitPriceDiram: 1000n,
      isPrescriptionRequired: false,
      controlCategory: 'psychotropic',
    })

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ControlledSubstanceNotOrderableError)
    }
    expect(await cartRepository.findItemsByCartId(TENANT_ID, CART_ID)).toHaveLength(0)
  })

  it('AC2b: controlCategory=narcotic → тоже запрещено (обе категории SRS-ORD-003)', async () => {
    const { catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSnapshot({
      medicineId: MEDICINE_ID,
      unitPriceDiram: 1000n,
      isPrescriptionRequired: false,
      controlCategory: 'narcotic',
    })

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(false)
  })

  it('AC3: пересечение веществ с уже лежащей в корзине позицией → warnings содержит duplicate_substance, добавление успешно', async () => {
    const { cartRepository, catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSnapshot({
      medicineId: OTHER_MEDICINE_ID,
      tradeName: 'Медикамент Б',
      unitPriceDiram: 500n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    catalogFacadePort.setSubstances(MEDICINE_ID, [{ substanceId: 'substance-x', name: 'Ибупрофен' }])
    catalogFacadePort.setSubstances(OTHER_MEDICINE_ID, [
      { substanceId: 'substance-x', name: 'Ибупрофен' },
      { substanceId: 'substance-y', name: 'Парацетамол' },
    ])
    // Товар А (OTHER_MEDICINE_ID) уже в корзине.
    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: OTHER_MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    // Товар Б (MEDICINE_ID) добавляется — та же subst-x, другая аптека.
    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: OTHER_PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      // DTJ-234 (дефект приёмки): warnings теперь несёт человекочитаемые названия обоих
      // медикаментов И пересёкшегося вещества, не только id.
      expect(result.value.warnings).toEqual([
        {
          type: 'duplicate_substance',
          existingMedicineId: OTHER_MEDICINE_ID,
          existingMedicineTradeName: 'Медикамент Б',
          newMedicineId: MEDICINE_ID,
          newMedicineTradeName: 'Медикамент А',
          substanceNames: ['Ибупрофен'],
        },
      ])
    }
    expect(await cartRepository.findItemsByCartId(TENANT_ID, CART_ID)).toHaveLength(2)
  })

  it('DTJ-234: пересечение с медикаментом БЕЗ снимка (снят с публикации) → existingMedicineTradeName=null, НЕ id', async () => {
    const cartRepository = new InMemoryCartRepository()
    cartRepository.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: null, sessionToken: 'guest-1' })
    const catalogFacadePort = new FakeCatalogFacadePort()
    catalogFacadePort.setSnapshot({
      medicineId: MEDICINE_ID,
      tradeName: 'Медикамент А',
      unitPriceDiram: 1000n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    // OTHER_MEDICINE_ID НЕ получает setSnapshot — снимок недоступен, но вещества всё ещё известны.
    catalogFacadePort.setSubstances(MEDICINE_ID, [{ substanceId: 'substance-x', name: 'Ибупрофен' }])
    catalogFacadePort.setSubstances(OTHER_MEDICINE_ID, [{ substanceId: 'substance-x', name: 'Ибупрофен' }])
    // Кладём строку напрямую в репозиторий — как если бы она была добавлена ДО снятия медикамента
    // с публикации (execute() с OTHER_MEDICINE_ID упал бы NotFoundError без снимка).
    await cartRepository.upsertItem(TENANT_ID, {
      cartId: CART_ID,
      medicineId: OTHER_MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantityDelta: 1,
    })
    const useCase = new AddCartItemUseCase(
      cartRepository,
      catalogFacadePort,
      new FakeCartHoldStorePort(),
      new StubConfig() as unknown as AppConfigService,
    )

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: OTHER_PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.warnings).toEqual([
        {
          type: 'duplicate_substance',
          existingMedicineId: OTHER_MEDICINE_ID,
          existingMedicineTradeName: null,
          newMedicineId: MEDICINE_ID,
          newMedicineTradeName: 'Медикамент А',
          substanceNames: ['Ибупрофен'],
        },
      ])
      expect(result.value.warnings[0]?.existingMedicineTradeName).not.toBe(OTHER_MEDICINE_ID)
    }
  })

  it('AC3b: тот же medicineId на другой аптеке НЕ считается "дублирующимся веществом" (это тот же товар)', async () => {
    const { catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSubstances(MEDICINE_ID, ['substance-x'])
    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: OTHER_PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.warnings).toEqual([])
    }
  })

  it('без пересечения веществ — warnings пуст', async () => {
    const { catalogFacadePort, useCase } = setUp()
    catalogFacadePort.setSnapshot({
      medicineId: OTHER_MEDICINE_ID,
      unitPriceDiram: 500n,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
    catalogFacadePort.setSubstances(MEDICINE_ID, ['substance-x'])
    catalogFacadePort.setSubstances(OTHER_MEDICINE_ID, ['substance-z'])
    await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: OTHER_MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    const result = await useCase.execute({
      tenantId: TENANT_ID,
      cartId: CART_ID,
      medicineId: MEDICINE_ID,
      pharmacyId: PHARMACY_ID,
      quantity: 1,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.warnings).toEqual([])
    }
  })

  it('несуществующая корзина → NotFoundError', async () => {
    const { useCase } = setUp()
    await expect(
      useCase.execute({
        tenantId: TENANT_ID,
        cartId: randomUUID(),
        medicineId: MEDICINE_ID,
        pharmacyId: PHARMACY_ID,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('несуществующий медикамент → NotFoundError', async () => {
    const { useCase } = setUp()
    await expect(
      useCase.execute({
        tenantId: TENANT_ID,
        cartId: CART_ID,
        medicineId: randomUUID(),
        pharmacyId: PHARMACY_ID,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('quantity <= 0 → ValidationError', async () => {
    const { useCase } = setUp()
    await expect(
      useCase.execute({
        tenantId: TENANT_ID,
        cartId: CART_ID,
        medicineId: MEDICINE_ID,
        pharmacyId: PHARMACY_ID,
        quantity: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('SRS-API-046: корзина существует, но принадлежит ДРУГОМУ тенанту → NotFoundError (не Forbidden), строка не создана', async () => {
    const { cartRepository, useCase } = setUp()

    await expect(
      useCase.execute({
        tenantId: OTHER_TENANT_ID,
        cartId: CART_ID,
        medicineId: MEDICINE_ID,
        pharmacyId: PHARMACY_ID,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // Проверяем ИЗ ПРАВИЛЬНОГО тенанта — утечки записи в чужой тенант не произошло.
    expect(await cartRepository.findItemsByCartId(TENANT_ID, CART_ID)).toHaveLength(0)
  })
})
