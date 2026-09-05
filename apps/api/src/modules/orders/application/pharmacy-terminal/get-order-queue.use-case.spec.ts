/**
 * `GetOrderQueueUseCase` (DTJ-301, SRS-PHT-005/005a) — область видимости (`pharmacist` своя
 * аптека, `pharmacy_admin` вся сеть/явная аптека), `meta.groupedBy`, пагинация. Реальная
 * межсетевая изоляция на живом Postgres (TC-PHT-030) — интеграционный тест, вне периметра.
 */
import { isOk } from '@dorutj/domain-kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { GetOrderQueueUseCase, type GetOrderQueueActor } from './get-order-queue.use-case.js'

const TENANT_ID = 'tenant-1'
const PHARMACY_A = 'pharmacy-a'
const PHARMACY_B = 'pharmacy-b'
const PHARMACY_FOREIGN = 'pharmacy-foreign'
const CHAIN_ID = 'chain-1'
const FOREIGN_CHAIN_ID = 'chain-foreign'

interface OrderInParams {
  readonly pharmacyId: string
  readonly status: OrderSnapshot['status']
  readonly createdAt: Date
  readonly overrides?: Partial<OrderSnapshot>
}

/**
 * Объект-параметр (C5, `max-params` ≤3) — `pharmacyId`/`status`/`createdAt` — самые частые оси
 * фикстур этого файла. `items: [validOrderItemCommand({ pharmacyId })]` — ОБЯЗАТЕЛЬНО совпадает
 * с order-level `pharmacyId` (`validateSinglePharmacy`, `Order.create()`, DTJ-221) — дефолтный
 * item фикстуры несёт СВОЙ `pharmacyId: 'pharmacy-1'`, отличный от `PHARMACY_A`/`PHARMACY_B` этого
 * файла, без явного override `Order.create()` падал бы на этой проверке.
 */
function orderIn({ pharmacyId, status, createdAt, overrides = {} }: OrderInParams): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId,
      paymentMethod: 'alif_mobi',
      items: [validOrderItemCommand({ pharmacyId })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, createdAt, updatedAt: createdAt, ...overrides })
}

function makeRepo(): InMemoryOrderRepository {
  const repo = new InMemoryOrderRepository()
  repo.seedPharmacyChain(PHARMACY_A, CHAIN_ID)
  repo.seedPharmacyChain(PHARMACY_B, CHAIN_ID)
  repo.seedPharmacyChain(PHARMACY_FOREIGN, FOREIGN_CHAIN_ID)
  return repo
}

const PHARMACIST: GetOrderQueueActor = { role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_A, chainId: null }
const ADMIN: GetOrderQueueActor = { role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_A, chainId: CHAIN_ID }
const ADMIN_NO_CHAIN: GetOrderQueueActor = { role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_A, chainId: null }

describe('GetOrderQueueUseCase — область видимости (SRS-PHT-005/005a)', () => {
  let repo: InMemoryOrderRepository
  let useCase: GetOrderQueueUseCase

  beforeEach(() => {
    repo = makeRepo()
    useCase = new GetOrderQueueUseCase(repo)
  })

  it('pharmacist — видит ТОЛЬКО свою аптеку, без groupedBy', async () => {
    repo.seed(orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))
    repo.seed(orderIn({ pharmacyId: PHARMACY_B, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))

    const result = await useCase.execute({ actor: PHARMACIST, filterPharmacyId: null, cursor: null, limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.pharmacyId).toBe(PHARMACY_A)
    expect(result.groupedByPharmacyId).toBeNull()
  })

  it('pharmacist с filter[pharmacyId] чужой аптеки → ForbiddenError', async () => {
    await expect(
      useCase.execute({ actor: PHARMACIST, filterPharmacyId: PHARMACY_B, cursor: null, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('TC-PHT-030: pharmacy_admin БЕЗ filter[pharmacyId] → заказы ВСЕХ точек своей сети, groupedBy присутствует, чужая сеть отсутствует', async () => {
    const orderA = orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') })
    const orderB = orderIn({ pharmacyId: PHARMACY_B, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:01:00.000Z') })
    const orderForeign = orderIn({ pharmacyId: PHARMACY_FOREIGN, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:02:00.000Z') })
    repo.seed(orderA)
    repo.seed(orderB)
    repo.seed(orderForeign)

    const result = await useCase.execute({ actor: ADMIN, filterPharmacyId: null, cursor: null, limit: 20 })

    const ids = result.items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining([orderA.id, orderB.id]))
    expect(ids).not.toContain(orderForeign.id)
    expect(result.groupedByPharmacyId).toEqual({
      [PHARMACY_A]: [orderA.id],
      [PHARMACY_B]: [orderB.id],
    })
  })

  it('pharmacy_admin С filter[pharmacyId] СВОЕЙ сети → одна аптека, groupedBy=null', async () => {
    repo.seed(orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))
    repo.seed(orderIn({ pharmacyId: PHARMACY_B, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))

    const result = await useCase.execute({ actor: ADMIN, filterPharmacyId: PHARMACY_B, cursor: null, limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.pharmacyId).toBe(PHARMACY_B)
    expect(result.groupedByPharmacyId).toBeNull()
  })

  it('pharmacy_admin С filter[pharmacyId] ЧУЖОЙ сети → ForbiddenError (межсетевая изоляция, TC-PHT-030)', async () => {
    await expect(
      useCase.execute({ actor: ADMIN, filterPharmacyId: PHARMACY_FOREIGN, cursor: null, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin БЕЗ chainId (ASSUMPTION) → сужается до своей аптеки, без groupedBy', async () => {
    repo.seed(orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))
    repo.seed(orderIn({ pharmacyId: PHARMACY_B, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))

    const result = await useCase.execute({ actor: ADMIN_NO_CHAIN, filterPharmacyId: null, cursor: null, limit: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.pharmacyId).toBe(PHARMACY_A)
    expect(result.groupedByPharmacyId).toBeNull()
  })

  it('pharmacy_admin БЕЗ chainId, filter[pharmacyId] = СВОЯ аптека → успех (совпадает с actor.pharmacyId)', async () => {
    repo.seed(orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T10:00:00.000Z') }))

    const result = await useCase.execute({ actor: ADMIN_NO_CHAIN, filterPharmacyId: PHARMACY_A, cursor: null, limit: 20 })

    expect(result.items).toHaveLength(1)
  })

  it('pharmacy_admin БЕЗ chainId, filter[pharmacyId] = ЧУЖАЯ аптека → ForbiddenError', async () => {
    await expect(
      useCase.execute({ actor: ADMIN_NO_CHAIN, filterPharmacyId: PHARMACY_B, cursor: null, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('actor без pharmacyId вовсе (защитный случай) → ForbiddenError', async () => {
    const noPharmacy: GetOrderQueueActor = { role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: null, chainId: null }

    await expect(useCase.execute({ actor: noPharmacy, filterPharmacyId: null, cursor: null, limit: 20 })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('GetOrderQueueUseCase — сортировка + пагинация (делегирует OrderQueueSortPolicy)', () => {
  it('сортирует processing перед paid_escrow, пагинирует по limit, nextCursor открывает следующую страницу', async () => {
    const repo = makeRepo()
    const useCase = new GetOrderQueueUseCase(repo)
    const paidEscrow1 = orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T09:00:00.000Z') })
    const paidEscrow2 = orderIn({ pharmacyId: PHARMACY_A, status: 'paid_escrow', createdAt: new Date('2026-09-05T09:01:00.000Z') })
    const processing = orderIn({
      pharmacyId: PHARMACY_A,
      status: 'processing',
      createdAt: new Date('2026-09-05T08:00:00.000Z'),
      overrides: {
        slaDeadlineAt: new Date('2026-09-05T09:05:00.000Z'),
        processingStartedAt: new Date('2026-09-05T08:58:00.000Z'),
      },
    })
    repo.seed(paidEscrow1)
    repo.seed(paidEscrow2)
    repo.seed(processing, { id: 'pharmacist-x', name: 'X' })

    const page1 = await useCase.execute({ actor: PHARMACIST, filterPharmacyId: null, cursor: null, limit: 2 })
    expect(page1.items.map((i) => i.id)).toEqual([processing.id, paidEscrow1.id])
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await useCase.execute({
      actor: PHARMACIST,
      filterPharmacyId: null,
      cursor: page1.nextCursor,
      limit: 2,
    })
    expect(page2.items.map((i) => i.id)).toEqual([paidEscrow2.id])
    expect(page2.hasMore).toBe(false)
    expect(page2.nextCursor).toBeNull()
  })

  it('пустая очередь → items=[], hasMore=false, nextCursor=null', async () => {
    const repo = makeRepo()
    const useCase = new GetOrderQueueUseCase(repo)

    const result = await useCase.execute({ actor: PHARMACIST, filterPharmacyId: null, cursor: null, limit: 20 })

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })
})
