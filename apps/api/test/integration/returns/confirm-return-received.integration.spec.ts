/**
 * `ConfirmReturnReceivedUseCase` — integration (EP-11, DTJ-273, тест-план тикета, критерий
 * приёмки 4 / DoD «идемпотентность restock по order_id покрыта явным тестом»). Реальный
 * Postgres для `returns`-собственных портов И `ReturnsInventoryPort` (реально мутирует
 * `pharmacy_inventory.quantity`, см. JSDoc `DrizzleReturnsInventoryAdapter`) — идемпотентность
 * restock проверяется ЧИСЛОМ в колонке, не предположением о поведении мока.
 *
 * Покрывает:
 *  - happy path: `packagingIntact=true`, не подконтрольно, срок годности far-future → `disposition='restock'`,
 *    `pharmacy_inventory.quantity` увеличен РОВНО на `orderItem.quantity`.
 *  - AC4 — повторный вызов тем же `returnId` (уже `return_confirmed`) — `quantity` увеличен ОДИН РАЗ, не дважды.
 *  - `controlCategory='psychotropic'` → `disposition='destroy'`, `quantity` НЕ увеличен вовсе.
 *  - `packagingIntact=false` → `disposition='destroy'` (RestockConditionsNotMetError перехвачена use case'ом), `quantity` НЕ увеличен.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { isErr } from '@dorutj/domain-kernel'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { OrderReturn, ReturnReason } from '@/modules/returns/domain/index.js'
import { ConfirmReturnReceivedUseCase } from '@/modules/returns/application/use-cases/confirm-return-received.use-case.js'
import { DrizzleReturnsRepository } from '@/modules/returns/infrastructure/repositories/drizzle-returns.repository.js'
import { DrizzleReturnsOrdersFacadeAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-orders-facade.adapter.js'
import { DrizzleReturnsUnitOfWorkAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-unit-of-work.adapter.js'
import { DrizzleReturnsOutboxAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-outbox.adapter.js'
import { DrizzleReturnsInventoryAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-inventory-facade.adapter.js'
import pino from 'pino'
import {
  FakeReturnsTenantSettingsPort,
  cleanupMedicine,
  cleanupPharmacy,
  cleanupTenant,
  connect,
  isPostgresReachable,
  seedChain,
  seedMedicineWithInventory,
  seedOrder,
  seedOrderItem,
  seedPharmacy,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from './returns-test.fixture.js'

const FIXED_NOW = new Date('2026-09-06T12:00:00.000Z')
const FAR_FUTURE_EXPIRY = new Date('2030-01-01T00:00:00.000Z')
const ITEM_QUANTITY = 2
const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('ConfirmReturnReceivedUseCase — integration (DTJ-273)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let useCase: ConfirmReturnReceivedUseCase
  let repository: DrizzleReturnsRepository

  let tenantId: string
  let customerId: string
  let chainId: string
  let pharmacyId: string
  let orderId: string
  let medicineId: string
  let inventoryBatchId: string

  beforeAll(() => {
    ;({ pool, db } = connect())
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await cleanupTenant(db, tenantId)
    await cleanupMedicine(db, medicineId)
    await cleanupPharmacy(db, pharmacyId, chainId)
  })

  async function setup(medicineOpts?: { controlCategory?: 'none' | 'psychotropic' }): Promise<void> {
    tenantId = await seedTenant(db)
    customerId = await seedUser(db, tenantId, 'customer')
    chainId = await seedChain(db)
    pharmacyId = await seedPharmacy(db, chainId)
    orderId = await seedOrder(db, { tenantId, customerId, pharmacyId, status: 'delivered', deliveredAt: FIXED_NOW })
    const medicine = await seedMedicineWithInventory({
      db,
      pharmacyId,
      expiresAt: FAR_FUTURE_EXPIRY,
      initialQuantity: 5,
      ...(medicineOpts !== undefined && { opts: medicineOpts }),
    })
    medicineId = medicine.medicineId
    inventoryBatchId = medicine.inventoryBatchId
    await seedOrderItem({ db, orderId, medicineId, inventoryBatchId, quantity: ITEM_QUANTITY })

    repository = new DrizzleReturnsRepository(db)
    const ordersFacade = new DrizzleReturnsOrdersFacadeAdapter(db)
    const unitOfWork = new DrizzleReturnsUnitOfWorkAdapter(db)
    const outboxPort = new DrizzleReturnsOutboxAdapter(db)
    const inventoryPort = new DrizzleReturnsInventoryAdapter(db, pino({ enabled: false }))
    const tenantSettings = new FakeReturnsTenantSettingsPort(24, 30)
    useCase = new ConfirmReturnReceivedUseCase(repository, ordersFacade, tenantSettings, inventoryPort, unitOfWork, outboxPort, { now: () => FIXED_NOW })
  }

  function parseReason(raw: string): ReturnReason {
    const result = ReturnReason.parse(raw)
    if (isErr(result)) throw result.error
    return result.value
  }

  /** Заводит возврат НАПРЯМУЮ через домен, сразу в `return_in_transit` (единственный статус, из которого `confirmReceived()` разрешён). */
  async function seedReturnInTransit(): Promise<string> {
    const requested = OrderReturn.request(
      { id: crypto.randomUUID(), orderId, reason: parseReason('defect'), initiatedBy: customerId, initiatorRole: 'customer', existingNonTerminalReturnIds: [] },
      FIXED_NOW,
    )
    const { Money } = await import('@/shared-kernel/domain/value-objects/money.vo.js')
    requested.markInTransit(customerId, Money.fromDiram(1_000n))
    await repository.save(requested)
    return requested.id
  }

  async function readQuantity(): Promise<number> {
    const [row] = await db.select({ quantity: pharmacyInventory.quantity }).from(pharmacyInventory).where(eq(pharmacyInventory.id, inventoryBatchId))
    if (row === undefined) throw new Error('inventory batch not found')
    return row.quantity
  }

  it('happy path — packagingIntact=true, не подконтрольно, срок годности far-future → disposition=restock, quantity +ITEM_QUANTITY', async () => {
    await setup()
    const returnId = await seedReturnInTransit()

    const result = await useCase.execute({ tenantId, returnId, checklist: { packagingIntact: true } })

    expect(result.disposition).toBe('restock')
    expect(await readQuantity()).toBe(5 + ITEM_QUANTITY)
  })

  it('AC4 — повторный вызов тем же returnId (уже return_confirmed) — restock применён РОВНО один раз, не дважды', async () => {
    await setup()
    const returnId = await seedReturnInTransit()

    const first = await useCase.execute({ tenantId, returnId, checklist: { packagingIntact: true } })
    const second = await useCase.execute({ tenantId, returnId, checklist: { packagingIntact: true } })

    expect(first.disposition).toBe('restock')
    expect(second.disposition).toBe('restock') // no-op возвращает уже вычисленный disposition, не бросает
    expect(await readQuantity()).toBe(5 + ITEM_QUANTITY) // НЕ 5 + 2*ITEM_QUANTITY
  })

  it('controlCategory=psychotropic → disposition=destroy (ControlledSubstanceMustBeDestroyedError перехвачена), quantity НЕ увеличен', async () => {
    await setup({ controlCategory: 'psychotropic' })
    const returnId = await seedReturnInTransit()

    const result = await useCase.execute({ tenantId, returnId, checklist: { packagingIntact: true } })

    expect(result.disposition).toBe('destroy')
    expect(await readQuantity()).toBe(5)
  })

  it('packagingIntact=false → disposition=destroy (RestockConditionsNotMetError перехвачена), quantity НЕ увеличен', async () => {
    await setup()
    const returnId = await seedReturnInTransit()

    const result = await useCase.execute({ tenantId, returnId, checklist: { packagingIntact: false } })

    expect(result.disposition).toBe('destroy')
    expect(await readQuantity()).toBe(5)
  })
})
