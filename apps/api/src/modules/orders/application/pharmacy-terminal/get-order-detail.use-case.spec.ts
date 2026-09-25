/** `GetOrderDetailUseCase` — порты замоканы/фейкнуты, реальный Postgres — в интеграционном наборе. */
import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { FakeCatalogFacadePort } from '@/modules/orders/testing/fixtures/fake-catalog-facade-port.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { GetOrderDetailUseCase, type GetOrderDetailActor } from './get-order-detail.use-case.js'

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const PHARMACY_ID = 'pharmacy-1'
const OTHER_PHARMACY_ID = 'pharmacy-2'
const FOREIGN_PHARMACY_ID = 'pharmacy-foreign'
const CHAIN_ID = 'chain-1'
const MEDICINE_ID = 'medicine-1'

const PHARMACIST_OWN: GetOrderDetailActor = { role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, chainId: null }
const PHARMACIST_OTHER: GetOrderDetailActor = { role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: OTHER_PHARMACY_ID, chainId: null }
const ADMIN_SAME_PHARMACY: GetOrderDetailActor = { role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, chainId: CHAIN_ID }
const ADMIN_NO_CHAIN: GetOrderDetailActor = { role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: OTHER_PHARMACY_ID, chainId: null }

function makeOrder(pharmacyId: string, tenantId = TENANT_ID): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId,
      pharmacyId,
      items: [validOrderItemCommand({ pharmacyId, medicineId: MEDICINE_ID })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return created.value
}

interface Harness {
  readonly useCase: GetOrderDetailUseCase
  readonly repo: InMemoryOrderRepository
  readonly catalogFacade: FakeCatalogFacadePort
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const catalogFacade = new FakeCatalogFacadePort()
  return { useCase: new GetOrderDetailUseCase(repo, catalogFacade), repo, catalogFacade }
}

describe('GetOrderDetailUseCase', () => {
  it('pharmacist своей аптеки — возвращает заказ с позициями, medicineName из каталога', async () => {
    const { useCase, repo, catalogFacade } = makeHarness()
    const order = makeOrder(PHARMACY_ID)
    repo.seed(order)
    catalogFacade.setSnapshot({ medicineId: MEDICINE_ID, tradeName: 'Парацетамол 500мг', unitPriceDiram: 0n, isPrescriptionRequired: false, controlCategory: 'none' })

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN })

    expect(result.id).toBe(order.id)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.medicineName).toBe('Парацетамол 500мг')
  })

  it('медикамент отсутствует в снимке каталога — medicineName падает на medicineId (фолбэк)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(PHARMACY_ID)
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN })

    expect(result.items[0]?.medicineName).toBe(MEDICINE_ID)
  })

  it('pharmacist ЧУЖОЙ аптеки (тот же тенант) — 403 ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(PHARMACY_ID)
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_OTHER })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('заказ ЧУЖОГО тенанта — 404 NotFoundError (существование не подтверждается)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(PHARMACY_ID, OTHER_TENANT_ID)
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_OWN })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('заказ не найден вовсе — 404 NotFoundError', async () => {
    const { useCase } = makeHarness()

    await expect(useCase.execute({ orderId: 'missing-order', actor: PHARMACIST_OWN })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('pharmacy_admin своей аптеки напрямую — доступ есть без похода за chainId', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(PHARMACY_ID)
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: ADMIN_SAME_PHARMACY })

    expect(result.id).toBe(order.id)
  })

  it('pharmacy_admin — ДРУГАЯ аптека своей сети (chainId) — доступ есть', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(OTHER_PHARMACY_ID)
    repo.seed(order)
    repo.seedPharmacyChain(PHARMACY_ID, CHAIN_ID)
    repo.seedPharmacyChain(OTHER_PHARMACY_ID, CHAIN_ID)

    const result = await useCase.execute({ orderId: order.id, actor: ADMIN_SAME_PHARMACY })

    expect(result.id).toBe(order.id)
  })

  it('pharmacy_admin — аптека ЧУЖОЙ сети — 403 ForbiddenError (межсетевая изоляция)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(FOREIGN_PHARMACY_ID)
    repo.seed(order)
    repo.seedPharmacyChain(PHARMACY_ID, CHAIN_ID)
    repo.seedPharmacyChain(FOREIGN_PHARMACY_ID, 'chain-foreign')

    await expect(useCase.execute({ orderId: order.id, actor: ADMIN_SAME_PHARMACY })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin БЕЗ сети (chainId=null) — сужается до своей аптеки, чужая → 403', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder(PHARMACY_ID)
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: ADMIN_NO_CHAIN })).rejects.toBeInstanceOf(ForbiddenError)
  })
})
