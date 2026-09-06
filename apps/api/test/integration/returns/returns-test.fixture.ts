/**
 * Общие хелперы интеграционных тестов модуля `returns` (EP-11, DTJ-273/274) — сидинг
 * минимально необходимых строк (`tenants`/`users`/`couriers`/`pharmacies`/`orders`/
 * `order_items`/...) и лёгкие тест-дублёры МЕЖМОДУЛЬНЫХ портов (`ReturnsDeliveryPort`/
 * `ReturnsSupportFacadePort`/`ReturnsTenantSettingsPort`), которые сами по себе не являются
 * предметом этого эпика (реализации/SQL-корректность чужих модулей проверяются ИХ
 * собственными тестами) — тот же приём разделения, что явно разрешает тест-план DTJ-273/274
 * («Testcontainers Postgres + in-memory outbox», «мок ReturnsPaymentsPort»). Реальные
 * Drizzle-адаптеры `returns`-собственных портов (repository/orders-facade/unit-of-work/outbox/
 * inventory) конструируются В КАЖДОМ тесте напрямую — здесь только сидинг и внешние фейки.
 *
 * `TEST_DATABASE_URL`/`isPostgresReachable` — 1:1 приём
 * `test/integration/support/create-support-ticket.integration.spec.ts` (DTJ-279).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq, inArray } from 'drizzle-orm'
import type { OrderStatus } from '@dorutj/contracts'
import { tenants, tenantSettings as tenantSettingsTable } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { couriers } from '@/db/schema/couriers.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { categories } from '@/db/schema/categories.js'
import { medicines } from '@/db/schema/medicines.js'
import type { ControlCategoryValue } from '@/db/schema/control-category.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { orders, orderItems } from '@/db/schema/orders.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import type {
  ReturnsCourierAssignment,
  ReturnsDeliveryPort,
} from '@/modules/returns/application/ports/delivery-facade.port.js'
import type {
  ReturnsCreateSupportTicketCommand,
  ReturnsSupportFacadePort,
} from '@/modules/returns/application/ports/returns-support-facade.port.js'
import type { ReturnsTenantSettingsPort } from '@/modules/returns/application/ports/returns-tenant-settings.port.js'

export const TEST_DATABASE_URL =
  process.env.RETURNS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500

export async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

export function connect(): { pool: Pool; db: NodePgDatabase } {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL })
  return { pool, db: drizzle(pool) }
}

function orderNumber(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

export async function seedTenant(
  db: NodePgDatabase,
  overrides?: Partial<{ disputeWindowHours: number; returnRestockMinRemainingDays: number }>,
): Promise<string> {
  const tenantId = randomUUID()
  await db.insert(tenants).values({ id: tenantId, slug: `dtj273-${tenantId.slice(0, 8)}`, isNeutral: false })
  await db.insert(tenantSettingsTable).values({
    tenantId,
    brandName: 'DTJ-273 Test Brand',
    ...(overrides?.disputeWindowHours !== undefined && { disputeWindowHours: overrides.disputeWindowHours }),
    ...(overrides?.returnRestockMinRemainingDays !== undefined && {
      returnRestockMinRemainingDays: overrides.returnRestockMinRemainingDays,
    }),
  })
  return tenantId
}

export async function seedUser(db: NodePgDatabase, tenantId: string, role: string): Promise<string> {
  const id = randomUUID()
  await db.insert(users).values({ id, tenantId, role })
  return id
}

export async function seedPharmacy(db: NodePgDatabase, chainId: string | null = null): Promise<string> {
  const id = randomUUID()
  await db.insert(pharmacies).values({
    id,
    ...(chainId !== null && { chainId }),
    name: 'DTJ-273 Test Pharmacy',
    addressText: 'Dushanbe, test str. 1',
    latitude: '38.5598',
    longitude: '68.7870',
    phone: '+992000000000',
  })
  return id
}

export async function seedChain(db: NodePgDatabase): Promise<string> {
  const id = randomUUID()
  await db
    .insert(pharmacyChains)
    .values({ id, name: 'DTJ-273 Test Chain', legalEntityName: 'DTJ-273 LLC', tinInn: randomUUID().replace(/-/g, '').slice(0, 12) })
  return id
}

/** `couriers.user_id` — FK, `couriers.id` ИСПОЛЬЗУЕТСЯ как `orders.courier_id` (не `users.id`, см. схему). */
export async function seedCourier(db: NodePgDatabase, tenantId: string): Promise<string> {
  const userId = await seedUser(db, tenantId, 'courier')
  const id = randomUUID()
  await db.insert(couriers).values({
    id,
    userId,
    taxStatus: 'individual_patent',
    vehicleType: 'foot',
  })
  return id
}

export interface SeedOrderOptions {
  readonly tenantId: string
  readonly customerId: string
  readonly pharmacyId?: string
  readonly status: OrderStatus
  readonly paymentMethod?: string
  readonly billingStrategy?: 'single_invoice' | 'split_items_delivery'
  readonly deliveredAt?: Date | null
  readonly courierId?: string | null
}

export async function seedOrder(db: NodePgDatabase, opts: SeedOrderOptions): Promise<string> {
  const id = randomUUID()
  await db.insert(orders).values({
    id,
    orderNumber: orderNumber('DTJ273'),
    customerId: opts.customerId,
    tenantId: opts.tenantId,
    status: opts.status,
    paymentMethod: opts.paymentMethod ?? 'card',
    itemsTotalTjs: '50.00',
    deliveryFeeTjs: '10.00',
    totalAmountTjs: '60.00',
    deliveryAddress: 'Dushanbe, DTJ-273 test str. 1',
    checkoutAttemptId: randomUUID(),
    ...(opts.pharmacyId !== undefined && { pharmacyId: opts.pharmacyId }),
    ...(opts.billingStrategy !== undefined && { billingStrategy: opts.billingStrategy }),
    ...(opts.deliveredAt !== undefined && opts.deliveredAt !== null && { deliveredAt: opts.deliveredAt }),
    ...(opts.courierId !== undefined && opts.courierId !== null && { courierId: opts.courierId }),
  })
  return id
}

export interface SeedMedicineOptions {
  readonly controlCategory?: ControlCategoryValue
  readonly isPrescriptionRequired?: boolean
}

/** `chk_medicines_control_category_requires_rx` — 'potent'/'psychotropic'/'narcotic' ОБЯЗАН нести `is_prescription_required=true`. */
const CONTROL_CATEGORIES_REQUIRING_RX: ReadonlySet<string> = new Set(['potent', 'psychotropic', 'narcotic'])

/** Категория + лекарство + позиция остатка аптеки — минимальная цепочка FK для `order_items`/restock-тестов. */
export async function seedMedicineWithInventory(
  db: NodePgDatabase,
  pharmacyId: string,
  expiresAt: Date,
  opts?: SeedMedicineOptions,
): Promise<{ readonly medicineId: string; readonly inventoryBatchId: string }> {
  const [category] = await db
    .insert(categories)
    .values({ slug: `dtj273-cat-${randomUUID().slice(0, 8)}`, nameTj: 'Тест', nameRu: 'Тест', nameEn: 'Test', commissionCategory: 'otc' })
    .returning({ id: categories.id })
  const medicineId = randomUUID()
  await db.insert(medicines).values({
    id: medicineId,
    tradeName: 'DTJ-273 Test Medicine',
    innName: 'Test Substance',
    categoryId: category?.id ?? 0,
    dosageForm: 'tablet',
    dosageStrength: '10mg',
    manufacturerCountry: 'TJ',
    manufacturerName: 'DTJ-273 Test Manufacturer',
    controlCategory: opts?.controlCategory ?? 'none',
    isPrescriptionRequired: opts?.isPrescriptionRequired ?? CONTROL_CATEGORIES_REQUIRING_RX.has(opts?.controlCategory ?? 'none'),
  })
  const inventoryBatchId = randomUUID()
  await db.insert(pharmacyInventory).values({
    id: inventoryBatchId,
    pharmacyId,
    medicineId,
    price: 1000,
    quantity: 5,
    expiresAt: expiresAt.toISOString().slice(0, 10),
  })
  return { medicineId, inventoryBatchId }
}

export async function seedOrderItem(
  db: NodePgDatabase,
  orderId: string,
  medicineId: string,
  inventoryBatchId: string,
  quantity: number,
): Promise<void> {
  await db.insert(orderItems).values({
    orderId,
    medicineId,
    unitPriceTjs: '10.00',
    quantity,
    totalPriceTjs: (10 * quantity).toFixed(2),
    inventoryBatchId,
  })
}

const DEFAULT_COURIER_FEE_DIRAM = 5_000n

/** Тест-дублёр `ReturnsDeliveryPort` — записывает вызовы, возвращает детерминированные значения (см. JSDoc файла). */
export class FakeReturnsDeliveryPort implements ReturnsDeliveryPort {
  readonly assignReturnCourierCalls: Array<{ tenantId: string; returnId: string }> = []
  readonly calculateReturnFeeCalls: Array<{ tenantId: string; orderId: string }> = []
  assignmentResult: ReturnsCourierAssignment | null = null
  feeDiram = DEFAULT_COURIER_FEE_DIRAM

  async assignReturnCourier(tenantId: string, returnId: string): Promise<ReturnsCourierAssignment | null> {
    this.assignReturnCourierCalls.push({ tenantId, returnId })
    return Promise.resolve(this.assignmentResult)
  }

  async calculateReturnFee(tenantId: string, orderId: string): Promise<bigint> {
    this.calculateReturnFeeCalls.push({ tenantId, orderId })
    return Promise.resolve(this.feeDiram)
  }
}

/** Тест-дублёр `ReturnsSupportFacadePort` — см. JSDoc файла: реальный `SupportFacade` тестируется своим модулем. */
export class FakeReturnsSupportFacadePort implements ReturnsSupportFacadePort {
  readonly calls: ReturnsCreateSupportTicketCommand[] = []
  ticketId = randomUUID()

  async createAutoOrManualTicket(command: ReturnsCreateSupportTicketCommand): Promise<{ readonly ticketId: string }> {
    this.calls.push(command)
    return Promise.resolve({ ticketId: this.ticketId })
  }
}

/** Тест-дублёр `ReturnsTenantSettingsPort` — числа контролируются тестом напрямую, не через реальный `tenant_settings`-адаптер. */
export class FakeReturnsTenantSettingsPort implements ReturnsTenantSettingsPort {
  constructor(
    private disputeWindowHours = 24,
    private returnRestockMinRemainingDays = 30,
  ) {}

  async getDisputeWindowHours(): Promise<number> {
    return Promise.resolve(this.disputeWindowHours)
  }

  async getReturnRestockMinRemainingDays(): Promise<number> {
    return Promise.resolve(this.returnRestockMinRemainingDays)
  }

  setDisputeWindowHours(hours: number): void {
    this.disputeWindowHours = hours
  }
}

/**
 * Полная очистка тестовых данных ОДНОГО тенанта — порядок FIXED FK (дети раньше родителей).
 * `order_returns`/`order_items` удаляются КАСКАДОМ через `orders` (`ON DELETE CASCADE`, см.
 * `db/schema/returns.ts`/`orders.ts`) — здесь удаляются только СТРОКИ, не имеющие каскада ОТ
 * `orders`/`tenants` (`couriers`, у которых `orders.courier_id` — `ON DELETE SET NULL`, не cascade).
 */
export async function cleanupTenant(db: NodePgDatabase, tenantId: string): Promise<void> {
  await db.delete(outbox).where(eq(outbox.tenantId, tenantId)).catch(() => undefined)
  await db.delete(orders).where(eq(orders.tenantId, tenantId)).catch(() => undefined)
  const tenantUsers = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, tenantId))
  const userIds = tenantUsers.map((u) => u.id)
  if (userIds.length > 0) {
    await db.delete(couriers).where(inArray(couriers.userId, userIds)).catch(() => undefined)
  }
  await db.delete(users).where(eq(users.tenantId, tenantId)).catch(() => undefined)
  await db.delete(tenantSettingsTable).where(eq(tenantSettingsTable.tenantId, tenantId)).catch(() => undefined)
  await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined)
}

/** Аптека/сеть — сидятся вне тенанта (`pharmacies`/`pharmacy_chains` не тенант-скоупные), очищаются явно по id. */
export async function cleanupPharmacy(db: NodePgDatabase, pharmacyId: string, chainId?: string | null): Promise<void> {
  await db.delete(pharmacies).where(eq(pharmacies.id, pharmacyId)).catch(() => undefined)
  if (chainId !== undefined && chainId !== null) {
    await db.delete(pharmacyChains).where(eq(pharmacyChains.id, chainId)).catch(() => undefined)
  }
}

/** Лекарство/остаток/категория, засеянные `seedMedicineWithInventory` — очищаются явно по id. */
export async function cleanupMedicine(db: NodePgDatabase, medicineId: string): Promise<void> {
  const [medicineRow] = await db.select({ categoryId: medicines.categoryId }).from(medicines).where(eq(medicines.id, medicineId))
  await db.delete(pharmacyInventory).where(eq(pharmacyInventory.medicineId, medicineId)).catch(() => undefined)
  await db.delete(orderItems).where(eq(orderItems.medicineId, medicineId)).catch(() => undefined)
  await db.delete(medicines).where(eq(medicines.id, medicineId)).catch(() => undefined)
  if (medicineRow?.categoryId !== undefined) {
    await db.delete(categories).where(eq(categories.id, medicineRow.categoryId)).catch(() => undefined)
  }
}
