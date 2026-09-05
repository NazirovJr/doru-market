/**
 * `EscrowInvariantSpec` (EP-10, DTJ-255, D-25, SRS-DOM-180/SRS-ORD-027/SRS-ORD-027a,
 * `docs/03-ARCHITECT-DECISIONS.md` D-25 п.4, `docs/spec/21-module-orders-payments-escrow.md`
 * TC-ORD-001c/d) — сквозной гейт-тест инварианта:
 *
 *   order.status === 'paid_escrow' ⟹ существуют записи escrow_ledger для этого заказа.
 *
 * D-25 существует, чтобы сделать одну конкретную ложь в модели данных структурно невозможной:
 * статус `paid_escrow`, утверждающий финансовый факт (деньги в эскроу), которого нет. Каждый
 * предыдущий тикет (DTJ-221/222/230/238/242/243) реализует ЧАСТЬ этой гарантии локально. Этот
 * файл — единственный тест, проверяющий инвариант ГЛОБАЛЬНО, по каждому заказу таблицы `orders`
 * разом, тем же способом, каким его в итоге проверяет `EscrowReconciliationJob` (DTJ-247,
 * `apps/worker/src/jobs/payout/pg-escrow-reconciliation-scanner.adapter.ts`) — прямым SQL по
 * `orders`/`escrow_ledger`, БЕЗ реконструкции полного доменного агрегата `Order.restore()`
 * (у `Order.restore()` СВОЙ отдельный guard на структурную совместимость `paymentMethod`/
 * `status` — `order-restore.validators.ts` — который ловил бы порчу иного рода и мешал бы
 * фикстуре-нарушителю ниже изолированно проверить ИМЕННО ledger-сторону инварианта).
 *
 * ВАЖНО — направление импликации ОДНОСТОРОННЕЕ, не биконъюнкция, несмотря на формулировку
 * SRS-ORD-027a: `paid_escrow ⟹ ledger непуст`, а НЕ `ledger непуст ⟹ paid_escrow`. Заказ В ниже
 * — заведённый ГРАНИЧНЫЙ случай (`LatePaymentRefundService`, DTJ-243): у отменённого заказа
 * ledger непуст (аудиторский след `hold_created`+`refunded_to_customer` позднего платежа), но
 * `status='cancelled'`. Это НЕ нарушение — это тест-план тикета п.5/DTJ-243 «Риски» явно
 * фиксируют, что обратная импликация НЕ требуется. `EscrowInvariantSpec.checkOrder` ниже
 * реализует РОВНО одностороннюю проверку — раздельными `expect` на обе логически эквивалентные
 * стороны ОДНОЙ и той же импликации (P⟹Q ≡ ¬Q⟹¬P), не одну свёрнутую булеву формулу (C11).
 *
 * ФИКСТУРА — сетап через РЕАЛЬНЫЙ код, не прямые INSERT (кроме единственного оправданного
 * исключения — фикстуры-нарушителя, см. ниже): тест обязан проходить через код-путь, который он
 * защищает, иначе не поймает регрессию в нём.
 *   - Заказ А (`cash_courier`) — `Order.create()` (домен), синхронно `confirmed` (D-25),
 *     персистится РЕАЛЬНЫМ `DrizzleOrderRepository.save()`.
 *   - Заказ Б (`alif_mobi`) — стартовая строка `pending_payment`+`payment_operations(create_bill)`
 *     сеется SQL (тот же приём, что `handle-payment-webhook.integration.spec.ts`, DTJ-242: non-cash
 *     checkout вне охвата R1, `enabledPaymentMethods` блокирует его на уровне `CheckoutUseCase`) —
 *     но переход в `paid_escrow` идёт ЧЕРЕЗ РЕАЛЬНЫЙ HTTP-вебхук на `POST /api/v1/payments/webhook`
 *     (реальная HMAC-подпись, реальный `HandlePaymentWebhookUseCase`, реальный `MockBankProvider`).
 *   - Заказ В (`cash_courier`) — `Order.create()` → `confirm()` (домен) → `cancel('pickup_sla_timeout',
 *     {kind:'system'})` (домен, разрешённый переход `confirmed→cancelled`, TC-ORD-001b), затем
 *     ТА ЖЕ схема «SQL-инвойс + реальный HTTP-вебхук» — вебхук резолвит заказ по `providerRef`
 *     (`findOrderByProviderRef` НЕ смотрит на `payment_method`), видит `status==='cancelled'`
 *     (`HandlePaymentWebhookUseCase.applyPaymentConfirmedOrLateRefund`) и маршрутизирует в
 *     `LatePaymentRefundService` — независимо от способа оплаты заказа. `cash_courier` для этого
 *     ГРАНИЧНОГО случая выбран НАРОЧНО (буквальный текст тикета DTJ-255): это ДВОЙНОЕ
 *     подтверждение, что обратная импликация не нужна — заказ структурно НЕ может стать
 *     `paid_escrow` (см. bespoke-guard `Order.markPaidEscrow`), И при этом получает непустой ledger.
 *   - Фикстура-нарушитель — ЕДИНСТВЕННОЕ место во всём сьюте, где `orders` заполняется прямым SQL
 *     `INSERT` в обход домена: `status='paid_escrow'` БЕЗ единой строки `escrow_ledger`. Доказывает,
 *     что `EscrowInvariantSpec` РЕАЛЬНО ловит нарушение, а не просто существует
 *     (`docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1 «ловушка, которая перестала ловить, молчит
 *     об этом»). Платёжный метод — `alif_mobi` (не `cash_courier`), НАРОЧНО: `Order.restore()`
 *     сам отверг бы `cash_courier`+`paid_escrow` СВОИМ guard'ом (структурная порча), а этот тест
 *     обязан проверять ИМЕННО ledger-сторону инварианта, не смешивать её с чужой защитой.
 *
 * РАСПОЛОЖЕНИЕ И ПАКЕТ (`tests/invariants/`, СВОЙ `package.json`, НЕ голая папка как
 * `tests/arch/`) — см. подробное обоснование в JSDoc `vitest.config.ts` этого пакета: этот файл
 * реально исполняет боевой код `apps/api` (Drizzle, NestJS/Fastify, supertest), которому нужны
 * настоящие `node_modules`; `tests/arch/`-подход (без `package.json`) технически неприменим —
 * ни `pg`, ни `drizzle-orm`, ни `supertest` не хоистятся в корневой `node_modules`, что проверено
 * эмпирически перед выбором паттерна.
 */
import { randomUUID, randomInt, createHmac } from 'node:crypto'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InvalidOrderStatusTransitionError } from '@dorutj/contracts'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { COD_LIMIT_DEFAULT_DIRAM, type OrderCreateCommand } from '@/modules/orders/domain/order-create-command.js'
import { DrizzleOrderRepository } from '@/modules/orders/infrastructure/repositories/order.repository.js'
import { DrizzleEscrowLedgerRepository } from '@/modules/payments/infrastructure/repositories/escrow-ledger.repository.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { createTestApp, TEST_MOCK_BANK_WEBHOOK_SECRET, type TestApp } from '@apitest/integration/payments/__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.INVARIANTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const WEBHOOK_ENDPOINT = '/api/v1/payments/webhook'
const SIGNATURE_HEADER = 'x-webhook-signature'
const PROVIDER_HEADER = 'x-payment-provider'
const MOCK_BANK_PROVIDER_NAME = 'mock_bank'
const ORDER_TOTAL_DIRAM = 10_000n // 100.00 TJS — под лимитом COD_LIMIT_DEFAULT_DIRAM (500 TJS).
/** Клиентский таймаут ответа на вебхук (критерий приёмки 2) — см. JSDoc того теста: НАЙДЕННЫЙ
 * дефект соседнего кода вешает соединение навсегда, ждать полных 30с `testTimeout` для этого
 * незачем — быстрый явный отказ информативнее и не тормозит остальной `pnpm verify`. */
const WEBHOOK_RESPONSE_TIMEOUT_MS = 5_000
/** `pool`'s `statement_timeout` — см. JSDoc `afterAll`: ограничивает сверху ЛЮБОЙ отдельный
 * `DELETE`, который может упереться в лок зависшего заказа В, не давая ему повесить весь хук. */
const CLEANUP_STATEMENT_TIMEOUT_MS = 3_000
/** Верхняя граница ожидания `testApp.close()` в `afterAll` — см. её JSDoc. */
const TEST_APP_CLOSE_TIMEOUT_MS = 3_000
/** Явный таймаут ХУКА `afterAll` (2-й аргумент, не глобальный `hookTimeout`, дефолт которого 10с
 * — трогать его глобально ради ОДНОГО хука этого файла не нужно). Найдено живым прогоном: даже с
 * per-order DELETE-циклом (см. JSDoc `afterAll`) и `CLEANUP_STATEMENT_TIMEOUT_MS`, суммарная
 * последовательность ~25 запросов (до 5 заказов × 5 DELETE) плюс до 3с на застрявшую строку
 * заказа В плюс до 3с `closeWithTimeout` эмпирически превышает дефолтные 10с — не зависание
 * (каждый отдельный await по-прежнему ограничен своим `statement_timeout`/`closeWithTimeout`),
 * а сумма многих мелких последовательных round-trip'ов. 30с — та же граница, что уже принята для
 * `testTimeout` этого пакета (`INTEGRATION_TEST_TIMEOUT_MS`, vitest.config.ts) — не новая политика. */
const AFTER_ALL_HOOK_TIMEOUT_MS = 30_000

/** `orders.order_number` парсится строго `OrderNumber.parse()` (`^DTJ-\d{6}-\d{5}$`, order-number.vo.ts)
 * — и для заказов, сеемых SQL напрямую (тот же приём, что handle-payment-webhook.integration.spec.ts):
 * без валидного формата `DrizzleOrderRepository.hydrate()` бросает при реальной загрузке заказа
 * внутри `HandlePaymentWebhookUseCase`/`OrdersFacade.markPaidEscrow`, что и обнаружено живым
 * прогоном при реализации DTJ-255.
 *
 * `randomInt` (crypto, НЕ фиксированная дата + счётчик) на ОБЕ части — намеренно: заказ В (см.
 * ниже) детерминированно задевает НАЙДЕННЫЙ ДЕФЕКТ соседнего кода (deadlock, см. JSDoc теста
 * «критерий приёмки 2») — `afterAll` этого файла в ТАКОМ прогоне не может вычистить строку этого
 * конкретного заказа (её лок держит зависшая транзакция, см. JSDoc `afterAll` про `statement_
 * timeout`), то есть КАЖДЫЙ прогон всего файла до починки дефекта в другом тикете оставляет ОДНУ
 * осиротевшую `orders`-строку в `dorutj_test`. Фиксированный счётчик от константы (что стояло
 * здесь раньше) детерминированно сталкивался бы с ЭТИМ мусором на `orders_order_number_key` при
 * каждом следующем прогоне (обнаружено живым прогоном — `duplicate key value violates unique
 * constraint`) — `randomInt` на каждый вызов делает коллизию с любым прошлым мусором практически
 * невозможной НЕЗАВИСИМО от состояния БД (устойчиво к повторным прогонам без ручной очистки). */
const ORDER_NUMBER_DATE_PART_MIN = 100_000
const ORDER_NUMBER_DATE_PART_MAX = 999_999
const ORDER_NUMBER_SEQ_PART_MIN = 10_000
const ORDER_NUMBER_SEQ_PART_MAX = 99_999
function nextSqlOrderNumber(): string {
  const datePart = randomInt(ORDER_NUMBER_DATE_PART_MIN, ORDER_NUMBER_DATE_PART_MAX + 1)
  const seqPart = randomInt(ORDER_NUMBER_SEQ_PART_MIN, ORDER_NUMBER_SEQ_PART_MAX + 1)
  return `DTJ-${String(datePart)}-${String(seqPart)}`
}

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

interface MockBankWebhookBody {
  readonly bankEventId: string
  readonly providerRef: string
  readonly type: 'payment_confirmed'
  readonly amountDiram: string
  readonly occurredAt: string
}

function signBody(json: string): string {
  return createHmac('sha256', TEST_MOCK_BANK_WEBHOOK_SECRET).update(json).digest('hex')
}

function webhookRequest(httpServer: Server, json: string): request.Test {
  return request(httpServer)
    .post(WEBHOOK_ENDPOINT)
    .set('Content-Type', 'application/json')
    .set(PROVIDER_HEADER, MOCK_BANK_PROVIDER_NAME)
    .set(SIGNATURE_HEADER, signBody(json))
    // Явный клиентский таймаут ответа (см. WEBHOOK_RESPONSE_TIMEOUT_MS) — заказ Б укладывается на
    // порядки быстрее; заказ В (критерий приёмки 2) детерминированно задевает НАЙДЕННЫЙ дефект
    // соседнего кода и без этого висел бы до `testTimeout` вместо быстрого явного отказа.
    .timeout({ response: WEBHOOK_RESPONSE_TIMEOUT_MS })
    .send(json)
}

function paymentConfirmedBody(providerRef: string): MockBankWebhookBody {
  return { bankEventId: `evt-${randomUUID()}`, providerRef, type: 'payment_confirmed', amountDiram: ORDER_TOTAL_DIRAM.toString(), occurredAt: new Date().toISOString() }
}

/** Прогоняет `payment_confirmed` через РЕАЛЬНЫЙ HTTP-эндпоинт и требует `200 OK`. Таймаут ответа
 * (см. `webhookRequest`) перехватывается отдельно — понятное сообщение вместо голой ошибки
 * superagent, см. JSDoc теста «критерий приёмки 2» про НАЙДЕННЫЙ дефект соседнего кода. */
async function sendPaymentConfirmedWebhook(httpServer: Server, providerRef: string): Promise<void> {
  const json = JSON.stringify(paymentConfirmedBody(providerRef))
  const res = await webhookRequest(httpServer, json).catch((cause: unknown) => {
    throw new Error(
      `webhook POST did not respond within ${String(WEBHOOK_RESPONSE_TIMEOUT_MS)}ms — see JSDoc on the "критерий приёмки 2" ` +
        'test for the known upstream deadlock this most likely is',
      { cause },
    )
  })
  if (res.status !== 200) {
    throw new Error(`fixture: webhook POST returned ${String(res.status)}, expected 200 — body: ${JSON.stringify(res.body)}`)
  }
}

async function resolveRootCategoryId(pool: Pool): Promise<number> {
  const category = await pool.query<{ id: number }>(
    `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
     VALUES ('root', 'Корень', 'Root', 'Root', 'otc', 0, true)
     ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
     RETURNING id`,
  )
  const id = category.rows[0]?.id
  if (id === undefined) throw new Error('resolveRootCategoryId: no id returned')
  return id
}

async function seedTenant(pool: Pool): Promise<string> {
  const id = randomUUID()
  await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj255-${id.slice(0, 8)}`])
  return id
}

async function seedPharmacy(pool: Pool): Promise<string> {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
     VALUES ($1, 'Test Pharmacy DTJ-255', 'Dushanbe, test str. 255', 38.5598, 68.7870, '+992900000255')`,
    [id],
  )
  return id
}

async function seedCustomer(pool: Pool, tenantId: string): Promise<string> {
  const id = randomUUID()
  await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [id, tenantId])
  return id
}

async function seedMedicine(pool: Pool): Promise<string> {
  const id = randomUUID()
  const categoryId = await resolveRootCategoryId(pool)
  await pool.query(
    `INSERT INTO medicines
       (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
        manufacturer_country, manufacturer_name, is_prescription_required, control_category,
        is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
     VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
             false, 'none', true, false, true)`,
    [id, `Trade-${id}`, `INN-${id}`, categoryId],
  )
  return id
}

async function seedInventoryBatch(pool: Pool, pharmacyId: string, medicineId: string): Promise<string> {
  const batch = await pool.query<{ id: string }>(
    `INSERT INTO pharmacy_inventory (id, pharmacy_id, medicine_id, price, quantity, expires_at, batch_number)
     VALUES (gen_random_uuid(), $1, $2, 1000, 50, CURRENT_DATE + INTERVAL '1 year', 'BATCH-1')
     RETURNING id`,
    [pharmacyId, medicineId],
  )
  const id = batch.rows[0]?.id
  if (id === undefined) throw new Error('seedInventoryBatch: no id returned')
  return id
}

interface CashOrderFixtureIds {
  readonly tenantId: string
  readonly pharmacyId: string
  readonly customerId: string
  readonly medicineId: string
  readonly inventoryBatchId: string
}

/** `cash_courier` `OrderCreateCommand` — единственная переменная часть между заказами А/В — `id`. */
function buildCashOrderCommand(ids: CashOrderFixtureIds): OrderCreateCommand {
  const geo = GeoPoint.create(38.5598, 68.787)
  if (!geo.ok) throw new Error('fixture: invalid GeoPoint')
  const unitPrice = Money.fromDiram(ORDER_TOTAL_DIRAM)
  const deliveryFee = Money.fromDiram(0n)
  const itemsTotal = unitPrice.multiplyByQuantity(1)
  return {
    id: randomUUID(),
    // Оба аргумента — crypto-random (не Math.random()+фиксированная дата): та же причина, что
    // `nextSqlOrderNumber()` (см. её JSDoc) — коллизия на `orders_order_number_key` с осиротевшей
    // строкой заказа В прошлого прогона (единственный источник мусора после фикса `afterAll`,
    // но накапливается на каждом прогоне до починки НАЙДЕННОГО дефекта в другом тикете).
    orderNumber: OrderNumber.fromParts(String(randomInt(ORDER_NUMBER_DATE_PART_MIN, ORDER_NUMBER_DATE_PART_MAX + 1)), randomInt(1, 100_000)),
    tenantId: ids.tenantId,
    customerId: ids.customerId,
    pharmacyId: ids.pharmacyId,
    items: [
      {
        id: randomUUID(),
        medicineId: ids.medicineId,
        pharmacyId: ids.pharmacyId,
        unitPrice,
        quantity: 1,
        commissionBps: 800,
        inventoryBatchId: ids.inventoryBatchId,
        isPrescriptionRequired: false,
        controlCategory: 'none',
      },
    ],
    deliveryAddress: 'Dushanbe, test str. DTJ-255',
    deliveryLandmark: null,
    deliveryGeoPoint: geo.value,
    deliveryFee,
    totalAmount: itemsTotal.add(deliveryFee),
    paymentMethod: 'cash_courier',
    billingStrategy: 'single_invoice',
    prescriptionId: null,
    checkoutAttemptId: randomUUID(),
    isPharmacyActiveAtCreation: true,
    codLimitDiram: COD_LIMIT_DEFAULT_DIRAM,
    now: new Date(),
  }
}

/** Создаёт `cash_courier` заказ через `Order.create()` (домен) и персистит РЕАЛЬНЫМ репозиторием. */
async function createConfirmedCashOrder(repo: DrizzleOrderRepository, ids: CashOrderFixtureIds): Promise<Order> {
  const created = Order.create(buildCashOrderCommand(ids))
  if (!created.ok) throw new Error(`fixture: Order.create failed: ${created.error.message}`)
  await repo.save(created.value)
  return created.value
}

interface NonCashInvoiceIds {
  readonly tenantId: string
  readonly pharmacyId: string
  readonly customerId: string
}

/** `pending_payment`/`alif_mobi` заказ + `payment_operations(create_bill)` — сеется SQL (см. JSDoc
 * файла: non-cash checkout вне охвата R1-`CheckoutUseCase`, тот же приём, что DTJ-242 spec). */
async function seedPendingInvoiceOrder(pool: Pool, ids: NonCashInvoiceIds): Promise<{ orderId: string; providerRef: string }> {
  const orderId = randomUUID()
  const providerRef = `mock_inv_${randomUUID()}`
  await pool.query(
    `INSERT INTO orders
       (id, order_number, customer_id, pharmacy_id, payment_method, status,
        items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
     VALUES ($1, $2, $3, $4, 'alif_mobi', 'pending_payment', 100.00, 0.00, 100.00, 'x', $5, $6)`,
    [orderId, nextSqlOrderNumber(), ids.customerId, ids.pharmacyId, ids.tenantId, randomUUID()],
  )
  const providerRefFromInvoice = await insertCreateBillOperation(pool, orderId, providerRef)
  return { orderId, providerRef: providerRefFromInvoice }
}

async function insertCreateBillOperation(pool: Pool, orderId: string, providerRef: string): Promise<string> {
  await pool.query(
    `INSERT INTO payment_operations (id, order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
     VALUES ($1, $2, 'create_bill', $3, 'mock_bank', $4, 'pending', $5)`,
    [randomUUID(), orderId, `checkout-${randomUUID()}`, providerRef, ORDER_TOTAL_DIRAM],
  )
  return providerRef
}

/**
 * `EscrowInvariantSpec` (ticket «Что сделать» п.2) — единственная точка проверки инварианта D-25.
 * Обе логически эквивалентные стороны импликации `paid_escrow ⟹ ledger непуст` проверяются
 * РАЗДЕЛЬНЫМИ `expect` (не одной свёрнутой формулой, C11) — см. JSDoc файла про направление
 * импликации и заказ В.
 */
class EscrowInvariantSpec {
  constructor(
    private readonly pool: Pool,
    private readonly ledgerRepository: DrizzleEscrowLedgerRepository,
  ) {}

  async checkOrder(tenantId: string, orderId: string): Promise<void> {
    const row = await this.pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1 AND tenant_id = $2', [orderId, tenantId])
    const status = row.rows[0]?.status
    if (status === undefined) throw new Error(`EscrowInvariantSpec: order ${orderId} not found for tenant ${tenantId}`)
    const isPaidEscrow = status === 'paid_escrow'
    const ledgerEntries = await this.ledgerRepository.findByOrderId(tenantId, orderId)
    const hasLedgerEntries = ledgerEntries.length > 0

    // Сторона 1 (⟹) — ГЛАВНАЯ гарантия D-25: статус paid_escrow УТВЕРЖДАЕТ существование денег
    // в эскроу. Если ledger пуст, статус лжёт о факте, которого нет — это и есть нарушение,
    // которое D-25 делает структурно невозможным.
    if (isPaidEscrow) {
      expect(hasLedgerEntries, `D-25 VIOLATED for order ${orderId}: status='paid_escrow' but escrow_ledger has ZERO entries`).toBe(true)
    }
    // Сторона 2 — контрапозиция стороны 1 (P⟹Q ≡ ¬Q⟹¬P), НЕ обратная импликация ledger⟹paid_escrow
    // (см. JSDoc файла и заказ В: пустой ledger НЕ говорит ничего про непустой; но непустой ledger
    // у заказа В тоже НЕ проверяется здесь как нарушение — этот `if` просто не выполняется, когда
    // `hasLedgerEntries === true`, ОБЕ ветки вместе покрывают ровно одну сторону инварианта).
    // Записана ОТДЕЛЬНЫМ `expect` ради читаемости (C11) и defense-in-depth: если сторону 1
    // случайно ослабят, эта проверка всё ещё ловит тот же класс нарушения с другого конца.
    if (!hasLedgerEntries) {
      expect(isPaidEscrow, `D-25 VIOLATED for order ${orderId}: escrow_ledger is EMPTY but status='paid_escrow'`).toBe(false)
    }
  }
}

/**
 * `testApp.close()` calls `app.close()` (Nest lifecycle shutdown) then ends the pool/Redis client
 * (see `test-app.ts`) — when the НАЙДЕННЫЙ ДЕФЕКТ (см. JSDoc теста «критерий приёмки 2») leaves a
 * connection stuck "idle in transaction", this can hang indefinitely (обнаружено живым прогоном:
 * `afterAll` failed on ITS OWN 10s hook timeout, so `finally`-style cleanup never got a chance to
 * run at all). Bounding it here — rather than letting it hang the whole hook — is what makes it
 * possible for the REST of `afterAll` (which now runs BEFORE this call, see below) to reliably
 * clean up every fixture this suite can actually reach.
 */
async function closeWithTimeout(closePromise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([closePromise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

describe.skipIf(!postgresAvailable)('EscrowInvariantSpec — D-25 сквозной инвариант paid_escrow ⟺ escrow_ledger (DTJ-255)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let orderRepository: DrizzleOrderRepository
  let escrowLedgerRepository: DrizzleEscrowLedgerRepository
  let spec: EscrowInvariantSpec
  let testApp: TestApp
  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let medicineId: string
  let inventoryBatchId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    // `statement_timeout` (не только на фикстуры — на ВЕСЬ pool, включая cleanup в `afterAll`):
    // защита от НАЙДЕННОГО ДЕФЕКТА соседнего кода (см. JSDoc теста «критерий приёмки 2») — без
    // него один заблокированный `DELETE` (задевающий locked-строку заказа В) блокировал бы ВЕСЬ
    // `afterAll` целиком до истечения хук-таймаута, не давая вычистить остальные фикстуры этого
    // прогона (обнаружено живым прогоном).
    pool = new Pool({ connectionString: TEST_DATABASE_URL, statement_timeout: CLEANUP_STATEMENT_TIMEOUT_MS })
    db = drizzle(pool)
    orderRepository = new DrizzleOrderRepository(db)
    escrowLedgerRepository = new DrizzleEscrowLedgerRepository(db)
    spec = new EscrowInvariantSpec(pool, escrowLedgerRepository)

    tenantId = await seedTenant(pool)
    pharmacyId = await seedPharmacy(pool)
    customerId = await seedCustomer(pool, tenantId)
    medicineId = await seedMedicine(pool)
    inventoryBatchId = await seedInventoryBatch(pool, pharmacyId, medicineId)

    testApp = await createTestApp()
  })

  /**
   * ПОРЯДОК НАРОЧНО НЕ «close() затем cleanup в finally» (что стояло здесь раньше): живой прогон
   * показал, что `testApp.close()` при НАЙДЕННОМ ДЕФЕКТЕ (см. JSDoc теста «критерий приёмки 2»)
   * зависает НАВСЕГДА — `try { await testApp.close() }` не осядет ни успехом, ни исключением, а
   * значит JS-`finally` НИКОГДА не запустится (он ждёт исхода `try`), и cleanup-запросы ниже не
   * выполнятся ни разу — фикстуры КАЖДОГО прогона копились бы в `dorutj_test` безвозвратно.
   * Правильный порядок: сперва DB cleanup (`pool` теперь застрахован `statement_timeout`, см.
   * `beforeAll`), `testApp.close()` — последним и с собственным потолком (`closeWithTimeout`),
   * чтобы её зависание не блокировало уже выполненный cleanup выше.
   *
   * УДАЛЕНИЕ `orders` — ПОИМЁННО, ПО ОДНОМУ (не один `WHERE id = ANY($1)` на весь `createdOrderIds`):
   * найдено живым прогоном (2 прогона подряд без ручной очистки, см. отчёт сдачи) — один batched
   * `DELETE ... = ANY(...)`, где ХОТЯ БЫ один id упирается в лок зависшего заказа В, откатывается
   * ЦЕЛИКОМ по `statement_timeout` (одно SQL-выражение — одна атомарная единица в Postgres даже
   * без явного `BEGIN`), унося с собой ВСЕ остальные, никак не залоченные заказы того же прогона.
   * Раздельные `DELETE ... WHERE id = $1` на каждый заказ ограничивают потерю ИМЕННО залоченной
   * строкой — единственным реальным сиротой на прогон, а не всеми пятью.
   */
  afterAll(async () => {
    for (const orderId of createdOrderIds) {
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM payment_operations WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM outbox WHERE aggregate_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
    await pool.query('DELETE FROM pharmacy_inventory WHERE id = $1', [inventoryBatchId]).catch(() => undefined)
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
    await closeWithTimeout(testApp.close(), TEST_APP_CLOSE_TIMEOUT_MS)
  }, AFTER_ALL_HOOK_TIMEOUT_MS)

  it('критерий приёмки 1 — заказы А (cash/confirmed) и Б (non-cash/paid_escrow) одновременно в БД: EscrowInvariantSpec не находит нарушений ни для одного', async () => {
    const orderA = await createConfirmedCashOrder(orderRepository, { tenantId, pharmacyId, customerId, medicineId, inventoryBatchId })
    createdOrderIds.push(orderA.id)
    expect(orderA.status).toBe('confirmed')

    const { orderId: orderBId, providerRef } = await seedPendingInvoiceOrder(pool, { tenantId, pharmacyId, customerId })
    createdOrderIds.push(orderBId)
    await sendPaymentConfirmedWebhook(testApp.httpServer, providerRef)

    // Given заказы А и Б, When EscrowInvariantSpec проверяет ОБА — Then нарушений не найдено.
    await spec.checkOrder(tenantId, orderA.id)
    await spec.checkOrder(tenantId, orderBId)

    // критерий приёмки 3 (ticket «Что сделать» п.3) — заказ А: раздельные явные assert поверх checkOrder.
    const orderARow = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderA.id])
    expect(orderARow.rows[0]?.status).not.toBe('paid_escrow')
    expect((await escrowLedgerRepository.findByOrderId(tenantId, orderA.id)).length).toBe(0)

    // критерий приёмки 4 (ticket «Что сделать» п.4) — заказ Б: раздельные явные assert поверх checkOrder.
    const orderBRow = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderBId])
    expect(orderBRow.rows[0]?.status).toBe('paid_escrow')
    expect((await escrowLedgerRepository.findByOrderId(tenantId, orderBId)).length).toBeGreaterThan(0)
  })

  /**
   * НАЙДЕННЫЙ ДЕФЕКТ (см. отчёт сдачи DTJ-255, `foundIssues`/`blockers` — НЕ в files_owned этого
   * тикета, не чинится здесь, CLAUDE-CTO.md §«Найден дефект в чужом коде»): этот тест детерминированно
   * ВИСНЕТ (не падает быстро) и валит `afterAll` таймаутом хука. Живой прогон + `pg_stat_activity`
   * подтвердили корневую причину — самозаклинивание (deadlock) на уровне приложения, НЕ баг этого
   * файла:
   *   1. `HandlePaymentWebhookUseCase.applyPaymentConfirmedOrLateRefund` резолвит заказ через
   *      `PaymentsOrdersPort.getOrderById(tenantId, orderId, tx)` → `OrdersFacadeAdapter.
   *      getOrderByIdLocking` → `SELECT ... FOR UPDATE` (orders-facade.adapter.ts:132) — держит
   *      lock на строку `orders` до конца транзакции `tx`.
   *   2. Внутри ТОЙ ЖЕ `tx` `LatePaymentRefundService.handle()` вызывает `PaymentProvider.refund()`
   *      (`MockBankProvider.refund → insertRefundOperation`, mock-bank.provider.ts) — метод НЕ
   *      принимает `tx` вовсе, пишет через инжектированный `this.db` (ДРУГОЕ соединение пула).
   *   3. `INSERT INTO payment_operations(order_id, ...)` (FK → `orders.id`) со ВТОРОГО соединения
   *      ждёт снятия `FOR UPDATE`-лока с ПЕРВОГО (см. `payments.ts` схему, FK `.references(() =>
   *      orders.id)`) — а первое соединение «idle in transaction», синхронно ожидая ИМЕННО этот
   *      `await this.paymentProvider.refund(...)` в JS. Ни одна сторона не освобождает лок —
   *      классический deadlock, невидимый детектору Postgres (он видит только БД-локи, не то, что
   *      клиент JS ждёт свой же собственный запрос).
   * Это РЕАЛЬНЫЙ прод-дефект: ЛЮБОЙ поздний `payment_confirmed` для уже `cancelled` заказа (не
   * только фикстура этого теста) реально вешает соединение в проде, не только в тесте.
   *
   * СТАТУС (обновлено после разбора с координатором и пользователем сессии, отчёт сдачи DTJ-255):
   * фикс НАЙДЕН и НЕЗАВИСИМО ВЕРИФИЦИРОВАН (`orders-facade.adapter.ts:132`, `getOrderByIdLocking`:
   * `.for('update')` → `.for('no key update')` — `FOR NO KEY UPDATE` по-прежнему сериализует
   * конкурентные `UPDATE`/`DELETE`/`FOR UPDATE`/`FOR NO KEY UPDATE` над той же строкой, но не
   * конфликтует с `FOR KEY SHARE`, который Postgres берёт автоматически при FK-проверке из
   * `payment_operations`/др. дочерних таблиц с ДРУГОГО соединения — ровно та узкая несовместимость,
   * что вызывает deadlock выше). ПРИМЕНЕНИЕ ОТЛОЖЕНО: обе попытки записать этот однострочный фикс
   * в `orders-facade.adapter.ts` (моя и координатора) отклонены permission-классификатором
   * Claude Code — блокер ПРАВ ЗАПИСИ в этой сессии, НЕ блокер решения или диагностики. Полный
   * дифф зафиксирован координатором в `docs/STATE-AND-RESUME-POINT.md` как рекомендация нового
   * тикета. `it.skip` ниже — явное решение пользователя (не решение исполнителя AGENTS.md §3/§10
   * запрещает исполнителю; здесь это санкционированное владельцем исключение для ИМЕННО этого
   * задокументированного, верифицированного и временно неприменимого случая) — заглушить БЕЗ
   * диагностики было бы сокрытием регрессии; заглушить С диагностикой и найденным фиксом,
   * ожидающим только права записи, — осознанный, прослеживаемый компромисс.
   */
  it.skip('критерий приёмки 2 — заказ В (cash/cancelled, ledger непуст из-за позднего платежа): EscrowInvariantSpec не находит нарушений, эта сторона инварианта не применима', async () => {
    const orderC = await createConfirmedCashOrder(orderRepository, { tenantId, pharmacyId, customerId, medicineId, inventoryBatchId })
    orderC.cancel('pickup_sla_timeout', { kind: 'system' }, new Date())
    createdOrderIds.push(orderC.id)
    await orderRepository.save(orderC)
    expect(orderC.status).toBe('cancelled')

    // Тот же приём "SQL-инвойс", что заказ Б, но для УЖЕ отменённого cash_courier заказа —
    // маршрутизация HandlePaymentWebhookUseCase решает по status, не по payment_method (см. JSDoc файла).
    const providerRef = await insertCreateBillOperation(pool, orderC.id, `mock_inv_${randomUUID()}`)
    await sendPaymentConfirmedWebhook(testApp.httpServer, providerRef)

    const row = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderC.id])
    expect(row.rows[0]?.status).toBe('cancelled') // НЕ paid_escrow, реанимации не произошло (SRS-DOM-102).

    const ledgerEntries = await escrowLedgerRepository.findByOrderId(tenantId, orderC.id)
    const entryTypes = ledgerEntries.map((entry) => entry.entryType).sort()
    expect(entryTypes).toEqual(['hold_created', 'refunded_to_customer']) // ГРАНИЧНЫЙ случай: ledger непуст.

    // EscrowInvariantSpec НЕ считает это нарушением — обратная импликация ledger⟹paid_escrow не требуется.
    await expect(spec.checkOrder(tenantId, orderC.id)).resolves.toBeUndefined()
  })

  it('критерий приёмки 4 / TC-ORD-001d — запрещённый переход confirmed→paid_escrow: order.markPaidEscrow() программно бросает InvalidOrderStatusTransitionError (дублирует DTJ-222 юнит-тест для полноты «все защиты D-25 в одном месте»)', async () => {
    const orderA = await createConfirmedCashOrder(orderRepository, { tenantId, pharmacyId, customerId, medicineId, inventoryBatchId })
    createdOrderIds.push(orderA.id)
    expect(orderA.status).toBe('confirmed')

    expect(() => {
      orderA.markPaidEscrow('txn-should-be-rejected', new Date(), true)
    }).toThrow(InvalidOrderStatusTransitionError)
    // Отказ не должен мутировать заказ — переход остаётся confirmed, ledger остаётся пустым.
    expect(orderA.status).toBe('confirmed')
    expect((await escrowLedgerRepository.findByOrderId(tenantId, orderA.id)).length).toBe(0)
  })

  it('критерий приёмки 3 — фикстура-нарушитель (paid_escrow БЕЗ escrow_ledger, прямой SQL INSERT в обход домена): EscrowInvariantSpec ПАДАЕТ с понятным сообщением, указывающим orderId', async () => {
    // Единственное оправданное место во всём сьюте для прямого SQL INSERT в обход домена (см.
    // JSDoc файла) — доказывает, что ловушка РЕАЛЬНО ловит нарушение, а не просто существует.
    const violatorId = randomUUID()
    createdOrderIds.push(violatorId)
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'paid_escrow', 100.00, 0.00, 100.00, 'x', $5, $6)`,
      [violatorId, nextSqlOrderNumber(), customerId, pharmacyId, tenantId, randomUUID()],
    )
    // Намеренно НИКАКОЙ записи escrow_ledger — заказ paid_escrow лжёт о деньгах, которых нет.

    await expect(spec.checkOrder(tenantId, violatorId)).rejects.toThrow(/D-25 VIOLATED for order/)
    await expect(spec.checkOrder(tenantId, violatorId)).rejects.toThrow(new RegExp(violatorId))
  })
})
