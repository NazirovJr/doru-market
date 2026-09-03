/**
 * `CheckoutUseCase` — гонки и дрейф цены (EP-09, DTJ-231, SRS-ORD-023/039/040) против РЕАЛЬНЫХ
 * Postgres/Redis (`createTestApp()`, тот же харнесс, что `cart.controller.integration.spec.ts`,
 * D-EP09-14: живые сервисы + `describe.skipIf`, не Testcontainers).
 *
 * **Уровень теста — `CheckoutUseCase.execute()` напрямую (`app.get(CheckoutUseCase)`), не HTTP.**
 * `POST /api/v1/orders` — контроллер DTJ-233, СЛЕДУЮЩИЙ тикет (files_owned этого тикета —
 * ровно `detect-price-drift.service.ts`/`errors/price-or-stock-changed.error.ts`, «Технический
 * контекст» DTJ-231: «здесь только контракт поведения CheckoutUseCase»). Гонки идемпотентности
 * (AC2/4/5) держатся на РЕАЛЬНОМ `UNIQUE(user_id, endpoint, key)` `idempotency_keys`
 * (`DrizzleIdempotencyAttemptAdapter` → `DrizzleIdempotencyKeysRepository`, ТОТ ЖЕ путь, что будет
 * у HTTP-запроса) — вызов `execute()` напрямую бьёт в ТУ ЖЕ БД-гонку, минус транспортный слой,
 * который добавит DTJ-233. Гонка за остаток (AC3) — РЕАЛЬНЫЙ `InventoryFacadeAdapter.reserveStock`
 * (`SELECT ... FOR UPDATE` на `pharmacy_inventory`, `orders/infrastructure/adapters/
 * inventory-facade.adapter.ts`), не мок — координатор явно потребовал доказательства РЕАЛЬНОЙ
 * конкурентностью (`Promise.all` против живого Postgres), не заглушкой порта.
 *
 * Все заказы — `paymentMethod: 'cash_courier'`: `TenancyFacadeAdapter.getEnabledPaymentMethods`
 * в R1 константно `['cash_courier']` (Group C, колонки в БД нет) — non-cash в этом окружении
 * всегда `422 PAYMENT_METHOD_NOT_ENABLED`, не относится к предмету этого файла.
 */
import { randomUUID } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { CheckoutUseCase } from '@/modules/orders/application/checkout/checkout.use-case.js'
import type { CheckoutCommand } from '@/modules/orders/application/checkout/dto/checkout-command.dto.js'
import { IdempotencyKeyConflictError } from '@/common/idempotency/idempotency-keys.repository.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500

async function isPostgresReachable(url: string): Promise<boolean> {
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

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

/** ОТДЕЛЬНЫЙ тенант (не `GUEST_TENANT_ID` из `test-app.ts`) — параллельные файлы этого пакета
 *  бьют в ТУ ЖЕ `dorutj_test`, общий id создал бы гонку МЕЖДУ файлами, не внутри одного. */
const TENANT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const TENANT_SLUG = 'test-orders-race-231'

describe.skipIf(!postgresAvailable)('CheckoutUseCase — гонки и дрейф цены на живом Postgres (DTJ-231)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let checkoutUseCase: CheckoutUseCase
  let pharmacyId: string
  const createdUserIds: string[] = []
  const createdMedicineIds: string[] = []

  async function resolveRootCategoryId(): Promise<number> {
    const category = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ('root-dtj231', 'Корень', 'Root', 'Root', 'otc', 0, true)
       ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
       RETURNING id`,
    )
    const id = category.rows[0]?.id
    if (id === undefined) throw new Error('resolveRootCategoryId: no id returned')
    return id
  }

  async function seedMedicine(): Promise<string> {
    const id = randomUUID()
    const categoryId = await resolveRootCategoryId()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               false, 'none', true, false, true)`,
      [id, `Trade-DTJ231-${id}`, `INN-DTJ231-${id}`, categoryId],
    )
    createdMedicineIds.push(id)
    return id
  }

  async function seedInventory(forMedicineId: string, quantity: number, priceDiram: number): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + INTERVAL '1 year')`,
      [pharmacyId, forMedicineId, priceDiram, quantity],
    )
  }

  async function seedCustomer(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active)
       VALUES ($1, $2, $3, 'customer', true)`,
      [id, TENANT_ID, `+99291${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`],
    )
    createdUserIds.push(id)
    return id
  }

  /** `UNIQUE(tenant_id, customer_id)` на `cart` — РОВНО одна корзина на клиента, кэшируем id. */
  const cartIdByCustomer = new Map<string, string>()

  async function ensureCartForCustomer(customerId: string): Promise<string> {
    const cached = cartIdByCustomer.get(customerId)
    if (cached !== undefined) return cached
    const cartId = randomUUID()
    await pool.query(`INSERT INTO cart (id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [cartId, TENANT_ID, customerId])
    cartIdByCustomer.set(customerId, cartId)
    return cartId
  }

  /** Добавляет строку `cart_items` в (единственную) корзину клиента. */
  async function seedCartItem(customerId: string, forMedicineId: string, quantity: number): Promise<string> {
    const cartId = await ensureCartForCustomer(customerId)
    const itemId = randomUUID()
    await pool.query(
      `INSERT INTO cart_items (id, cart_id, medicine_id, pharmacy_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
      [itemId, cartId, forMedicineId, pharmacyId, quantity],
    )
    return itemId
  }

  function buildCommand(input: {
    customerId: string
    customerPhone: string
    cartItemIds: readonly string[]
    checkoutAttemptId: string
    expectedTotalDiramByPharmacy?: Readonly<Record<string, bigint>>
  }): CheckoutCommand {
    return {
      tenantId: TENANT_ID,
      customerId: input.customerId,
      customerPhone: input.customerPhone,
      cartItemIds: input.cartItemIds,
      deliveryAddressId: null,
      inlineAddress: { addressText: 'Dushanbe, Rudaki 1', landmarkText: null, latitude: 38.5598, longitude: 68.787 },
      deliveryLandmark: null,
      paymentMethod: 'cash_courier',
      prescriptionIds: [],
      expectedTotalDiramByPharmacy: input.expectedTotalDiramByPharmacy ?? {},
      checkoutAttemptId: input.checkoutAttemptId,
    }
  }

  let chainId: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, TENANT_SLUG],
    )
    // `OnboardingFacade.isPharmacyActive` (modules/onboarding) требует ОБА: `pharmacies.status
    // = 'active'` И родительскую `pharmacy_chains.status ∈ {approved,active}` (SRS-DOM-048) —
    // без активной цепочки checkout исключил бы аптеку как PHARMACY_SUSPENDED (foundIssue этого
    // прогона: голая `pharmacies`-строка без цепочки/`status` даёт `draft`-дефолт).
    const chain = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
       VALUES ($1, 'Test Chain DTJ-231', 'Test Chain LLC DTJ-231', $2, 'active')
       RETURNING id`,
      [randomUUID(), `TIN-DTJ231-${randomUUID().slice(0, 8)}`],
    )
    chainId = chain.rows[0]?.id ?? ''
    const pharmacy = await pool.query<{ id: string }>(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Test Pharmacy DTJ-231', 'Dushanbe, test str. 231', 38.5598, 68.7870, '+992900000231', 'active')
       RETURNING id`,
      [randomUUID(), chainId],
    )
    pharmacyId = pharmacy.rows[0]?.id ?? ''

    ctx = await createTestApp()
    app = ctx.app
    checkoutUseCase = app.get(CheckoutUseCase)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query(
        `DELETE FROM orders WHERE tenant_id = $1 AND pharmacy_id = $2`,
        [TENANT_ID, pharmacyId],
      )
      await pool.query(`DELETE FROM cart WHERE tenant_id = $1`, [TENANT_ID])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
      if (createdMedicineIds.length > 0) {
        await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [createdMedicineIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('AC1 — ожидание группы расходится с пересчитанной суммой на живой БД → failedGroups[0] = 409 PRICE_OR_STOCK_CHANGED, details.actualTotalDiram, заказ не создан', async () => {
    const priceDiram = 1_500
    const med = await seedMedicine()
    await seedInventory(med, 10, priceDiram)
    const customerId = await seedCustomer()
    const itemId = await seedCartItem(customerId, med, 2) // 1_500 × 2 = 3_000 диram актуальная сумма

    const result = await checkoutUseCase.execute(
      buildCommand({
        customerId,
        customerPhone: '+992900000001',
        cartItemIds: [itemId],
        checkoutAttemptId: randomUUID(),
        expectedTotalDiramByPharmacy: { [pharmacyId]: 2_000n }, // клиент видел устаревшую (более дешёвую) цену
      }),
    )

    expect(result.orders).toEqual([])
    expect(result.failedGroups).toHaveLength(1)
    expect(result.failedGroups[0]).toMatchObject({
      pharmacyId,
      reason: ErrorCode.PRICE_OR_STOCK_CHANGED,
      details: { actualTotalDiram: 3_000 },
    })
    const orderRow = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRow.rowCount).toBe(0)
  })

  it('AC2 — конкурентный дубль: два ОДНОВРЕМЕННЫХ execute() с ОДНИМ checkoutAttemptId на живом idempotency_keys → ровно один успешен, второй немедленно IdempotencyKeyConflictError (не ждёт первого, не создаёт второй заказ)', async () => {
    const priceDiram = 2_000
    const med = await seedMedicine()
    await seedInventory(med, 10, priceDiram)
    const customerId = await seedCustomer()
    const itemId = await seedCartItem(customerId, med, 1)
    const checkoutAttemptId = randomUUID()
    const cmd = buildCommand({ customerId, customerPhone: '+992900000002', cartItemIds: [itemId], checkoutAttemptId })

    const [first, second] = await Promise.allSettled([checkoutUseCase.execute(cmd), checkoutUseCase.execute(cmd)])

    const settled = [first, second]
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<CheckoutUseCase['execute']>>> => r.status === 'fulfilled')
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(IdempotencyKeyConflictError)

    const orderRows = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRows.rowCount).toBe(1) // НЕ два — конкурентный дубль не задвоил заказ/резерв
  })

  it('AC3 — гонка за последнюю единицу товара на живом Postgres (SELECT ... FOR UPDATE): stock_quantity=1, два РАЗНЫХ клиента конкурентно → ровно один успешен, второй INSUFFICIENT_STOCK, остаток не уходит в минус', async () => {
    const priceDiram = 1_000
    const med = await seedMedicine()
    await seedInventory(med, 1, priceDiram) // ровно одна единица на партию
    const customerA = await seedCustomer()
    const customerB = await seedCustomer()
    const itemA = await seedCartItem(customerA, med, 1)
    const itemB = await seedCartItem(customerB, med, 1)
    const cmdA = buildCommand({ customerId: customerA, customerPhone: '+992900000003', cartItemIds: [itemA], checkoutAttemptId: randomUUID() })
    const cmdB = buildCommand({ customerId: customerB, customerPhone: '+992900000004', cartItemIds: [itemB], checkoutAttemptId: randomUUID() })

    const [resultA, resultB] = await Promise.all([checkoutUseCase.execute(cmdA), checkoutUseCase.execute(cmdB)])

    const succeededCount = [resultA, resultB].filter((r) => r.orders.length === 1).length
    const failedCount = [resultA, resultB].filter((r) => r.failedGroups.length === 1).length
    expect(succeededCount).toBe(1)
    expect(failedCount).toBe(1)
    const failedResult = resultA.failedGroups.length === 1 ? resultA : resultB
    expect(failedResult.failedGroups[0]).toMatchObject({ pharmacyId, reason: ErrorCode.INSUFFICIENT_STOCK })

    const stockRow = await pool.query<{ quantity: number }>(
      'SELECT quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2',
      [pharmacyId, med],
    )
    expect(stockRow.rows[0]?.quantity).toBe(0) // не -1 — двойного списания не произошло
  })

  // ИСТОРИЯ (defect fix, найдено при сдаче DTJ-231/233, исправлено этой правкой). Тест-план
  // DTJ-231 называл этот кейс «опциональным, не блокирующим сдачу», и тело теста держалось
  // здесь `it.skip` как воспроизведение НАЙДЕННОГО критического дефекта в уже принятом коде
  // DTJ-227 (не чинилось молча, см. правило 7 AGENTS.md — доложено в отчёте сдачи DTJ-231, из
  // отчёта «НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ» ушло в отдельное задание этой правки).
  //
  // ДО правки: под РЕАЛЬНОЙ нагрузкой (50 конкурентных checkout, ≥ `DEFAULT_POOL_MAX=10` pg-Pool
  // соединений, `infrastructure/database/drizzle.provider.ts`) `CheckoutUseCase.processGroup`
  // МЁРТВО ВИСНЕТ (падает по тайм-ауту `120_000` ниже, не решается сам, доказано прогоном ДО
  // правки — вывод см. в отчёте сдачи), а не падает с ошибкой. Причина (диагностировано
  // `pg_stat_activity`/`pg_locks` во время зависания, НЕ рассуждением): ВСЕ соединения пула
  // застряли в состоянии `idle in transaction`, `query = 'begin'`, ЖДУТ клиента
  // (`wait_event = ClientRead`), НЕ ждут блокировку строки (`pg_locks` на `pharmacy_inventory` —
  // ПУСТ). Классический self-deadlock пула соединений: `OrdersUnitOfWorkPort.run(tx => ...)`
  // держал ОДНО соединение пула на всю транзакцию группы, а `CatalogFacadeAdapter
  // .getMedicineSnapshot` (вызывался ВНУТРИ этой транзакции, `processGroup`, акт вызова
  // существовал с DTJ-227) читал через ОБЫЧНЫЙ `DRIZZLE_DB` (порт
  // `CatalogFacadePort.getMedicineSnapshot` НЕ принимает `tx` — межмодульный фасад `catalog`),
  // то есть просил у ТОГО ЖЕ пула ВТОРОЕ соединение, не переиспользуя уже открытое. Как только
  // конкурентных групп ≥ `DEFAULT_POOL_MAX`, КАЖДАЯ уже держала своё единственное соединение под
  // `tx` и одновременно просила второе для `getMedicineSnapshot` — пул исчерпан, тупик навсегда.
  //
  // ПОСЛЕ правки: `CheckoutUseCase.processGroup` (см. её JSDoc, `checkout.use-case.ts`) читает
  // снимок каталога ДО открытия `tx` группы — второе соединение больше не запрашивается, пока
  // первое удержано. Тест теперь ВКЛЮЧЁН (не `it.skip`) и обязан оставаться зелёным — он
  // доказательство фикса, не опциональная проверка.
  it(
    'Нагрузочный — 50 конкурентных checkout на остаток из 10 единиц → ровно 10 успешных, 40 INSUFFICIENT_STOCK, ноль дублирующих резервов, БЕЗ self-deadlock пула соединений (defect fix — снимок каталога вынесен из tx группы, см. checkout.use-case.ts::processGroup)',
    async () => {
      const priceDiram = 900
      const stock = 10
      const requestCount = 50
      const med = await seedMedicine()
      await seedInventory(med, stock, priceDiram)

      const commands = await Promise.all(
        Array.from({ length: requestCount }, async (_unused, index) => {
          const customerId = await seedCustomer()
          const itemId = await seedCartItem(customerId, med, 1)
          return buildCommand({
            customerId,
            customerPhone: `+99290000${String(1000 + index)}`,
            cartItemIds: [itemId],
            checkoutAttemptId: randomUUID(),
          })
        }),
      )

      const results = await Promise.all(commands.map((cmd) => checkoutUseCase.execute(cmd)))

      const succeeded = results.filter((r) => r.orders.length === 1)
      const failedInsufficient = results.filter(
        (r) => r.failedGroups.length === 1 && r.failedGroups[0]?.reason === ErrorCode.INSUFFICIENT_STOCK,
      )
      expect(succeeded).toHaveLength(stock)
      expect(failedInsufficient).toHaveLength(requestCount - stock)

      const stockRow = await pool.query<{ quantity: number }>(
        'SELECT quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2',
        [pharmacyId, med],
      )
      expect(stockRow.rows[0]?.quantity).toBe(0) // ни дублирующего резерва, ни ухода в минус
    },
    120_000,
  )

  it('AC4 — повтор с ТЕМ ЖЕ checkoutAttemptId и ТЕМ ЖЕ телом ПОСЛЕ завершения первого → возвращён СОХРАНЁННЫЙ результат (тот же orderId), новый заказ не создаётся, reserveStock не вызывается повторно (остаток не списан дважды)', async () => {
    const priceDiram = 1_200
    const med = await seedMedicine()
    await seedInventory(med, 5, priceDiram)
    const customerId = await seedCustomer()
    const itemId = await seedCartItem(customerId, med, 1)
    const checkoutAttemptId = randomUUID()
    const cmd = buildCommand({ customerId, customerPhone: '+992900000005', cartItemIds: [itemId], checkoutAttemptId })

    const firstResult = await checkoutUseCase.execute(cmd)
    const secondResult = await checkoutUseCase.execute(cmd)

    expect(firstResult.orders).toHaveLength(1)
    expect(secondResult).toEqual(firstResult)
    const orderRows = await pool.query('SELECT id FROM orders WHERE customer_id = $1', [customerId])
    expect(orderRows.rowCount).toBe(1)
    const stockRow = await pool.query<{ quantity: number }>(
      'SELECT quantity FROM pharmacy_inventory WHERE pharmacy_id = $1 AND medicine_id = $2',
      [pharmacyId, med],
    )
    expect(stockRow.rows[0]?.quantity).toBe(4) // 5 - 1, НЕ 5 - 2
  })

  it('AC5 — ТОТ ЖЕ checkoutAttemptId, но ДРУГОЕ тело (другой cartItemIds) → IdempotencyKeyConflictError (несовпадение sha256(body))', async () => {
    const priceDiram = 1_100
    // Разные медикаменты — `unique_cart_medicine_pharmacy` не даёт две строки cart_items с
    // ОДНИМ и тем же (cartId, medicineId, pharmacyId), а тело команды всё равно отличается.
    const medFirst = await seedMedicine()
    const medSecond = await seedMedicine()
    await seedInventory(medFirst, 5, priceDiram)
    await seedInventory(medSecond, 5, priceDiram)
    const customerId = await seedCustomer()
    const firstItemId = await seedCartItem(customerId, medFirst, 1)
    const secondItemId = await seedCartItem(customerId, medSecond, 2)
    const checkoutAttemptId = randomUUID()
    const firstCmd = buildCommand({ customerId, customerPhone: '+992900000006', cartItemIds: [firstItemId], checkoutAttemptId })
    const differentBodyCmd = buildCommand({ customerId, customerPhone: '+992900000006', cartItemIds: [secondItemId], checkoutAttemptId })

    await checkoutUseCase.execute(firstCmd)

    await expect(checkoutUseCase.execute(differentBodyCmd)).rejects.toMatchObject({
      name: 'IdempotencyKeyConflictError',
      details: { reason: 'body_mismatch' },
    })
  })
})
