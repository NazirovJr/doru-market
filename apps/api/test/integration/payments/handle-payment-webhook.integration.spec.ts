/**
 * `HandlePaymentWebhookUseCase`/`PaymentsWebhookController` — Supertest-интеграция (EP-10,
 * DTJ-242, `21-module-orders-payments-escrow.md` §5, тест-план тикета) против РЕАЛЬНЫХ
 * Postgres/Redis (D-EP09-14 — Testcontainers не используются, `describe.skipIf`, тот же приём,
 * что весь `test/integration/**`).
 *
 * Заказ (`payment_method='alif_mobi'`, вне охвата R1-checkout — `enabledPaymentMethods`
 * блокирует его на уровне `CheckoutUseCase`, DTJ-229) сеется НАПРЯМУЮ SQL вместе с ОРИГИНАЛЬНОЙ
 * строкой `payment_operations(operation_type='create_bill')` — та же техника, что
 * `retry-payment.controller.integration.spec.ts` (DTJ-241): состояние недостижимо через HTTP в
 * R1, фикстура строится напрямую.
 *
 * `X-Webhook-Signature` — реальный HMAC-SHA256(hex) над ТОЧНО ТЕМИ ЖЕ байтами, что уходят
 * телом запроса (`JSON.stringify` вызывается РОВНО ОДИН РАЗ, строка передаётся supertest
 * `.send(jsonString)` — не объект, иначе повторная сериализация могла бы дать другую строку и
 * тест перестал бы проверять то, что заявляет, см. риск тикета: «JSON.stringify(req.body) — не
 * те же байты»).
 *
 * АС DTJ-242 (1-5) — по одному `it()` на критерий, плюс:
 *   - атомарность (искусственный сбой между `markPaidEscrow` и `EscrowLedger.append`,
 *     тест-план тикета) — прямой вызов use case (не через HTTP) с ОБЁРНУТЫМ `EscrowLedgerRepository`.
 *   - идемпотентность РЕАЛЬНОЙ конкурентностью — `Promise.all` двух одновременных POST с
 *     ОДНИМ `bankEventId` против живого Postgres (задание: «доказывай Promise.all, не моком»).
 */
import { randomUUID, createHmac } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import type { PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import type { BankWebhookVerifierRegistryPort } from '@/modules/payments/application/ports/bank-webhook-verifier-registry.port.js'
import {
  PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY,
  type PaymentWebhookOperationsPort,
} from '@/modules/payments/application/ports/payment-webhook-operations.port.js'
import { PAYMENTS_ORDERS_PORT, type PaymentsOrdersPort } from '@/modules/payments/application/ports/orders-facade.port.js'
import { PAYMENTS_OUTBOX, type PaymentsOutboxPort } from '@/modules/payments/application/ports/payments-outbox.port.js'
import { PAYMENTS_UNIT_OF_WORK, type PaymentsUnitOfWorkPort } from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/modules/payments/application/ports/audit-log.port.js'
import { LatePaymentRefundService } from '@/modules/payments/application/services/late-payment-refund.service.js'
import { HandlePaymentWebhookUseCase } from '@/modules/payments/application/use-cases/handle-payment-webhook.use-case.js'
import { createTestApp, TEST_MOCK_BANK_WEBHOOK_SECRET, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const WEBHOOK_ENDPOINT = '/api/v1/payments/webhook'
const SIGNATURE_HEADER = 'x-webhook-signature'
const PROVIDER_HEADER = 'x-payment-provider'
const ORDER_TOTAL_DIRAM = 15_000n // 150.00 TJS

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

interface ErrorBody {
  readonly error: { readonly code: string }
}

interface MockBankWebhookBody {
  readonly bankEventId: string
  readonly providerRef: string
  readonly type: 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed'
  readonly amountDiram: string
  readonly occurredAt: string
}

function signBody(json: string): string {
  return createHmac('sha256', TEST_MOCK_BANK_WEBHOOK_SECRET).update(json).digest('hex')
}

/** Объект-параметр (C5, `max-params` ≤3) — 4 логически неразделимых поля одного HTTP-вызова. */
interface WebhookRequestInput {
  readonly httpServer: Server
  readonly providerName: string
  readonly json: string
  readonly signature: string
}

function webhookRequest({ httpServer, providerName, json, signature }: WebhookRequestInput): request.Test {
  return request(httpServer)
    .post(WEBHOOK_ENDPOINT)
    .set('Content-Type', 'application/json')
    .set(PROVIDER_HEADER, providerName)
    .set(SIGNATURE_HEADER, signature)
    .send(json)
}

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260903-${String(orderNumberSeq).padStart(5, '0')}`
}

describe.skipIf(!postgresAvailable)('PaymentsWebhookController / HandlePaymentWebhookUseCase — Supertest integration (DTJ-242)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  const tenantId = randomUUID()
  let pharmacyId: string
  let chainId: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []

  async function seedPharmacy(): Promise<string> {
    const chain = await pool.query<{ id: string }>(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
       VALUES ($1, 'Test Chain DTJ-242', 'Test Chain LLC DTJ-242', $2, 'active') RETURNING id`,
      [randomUUID(), `TIN-DTJ242-${randomUUID().slice(0, 8)}`],
    )
    chainId = chain.rows[0]?.id ?? ''
    const pharmacy = await pool.query<{ id: string }>(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'Test Pharmacy DTJ-242', 'Dushanbe, test str. 242', 38.5598, 68.7870, '+992900000242', 'active')
       RETURNING id`,
      [randomUUID(), chainId],
    )
    return pharmacy.rows[0]?.id ?? ''
  }

  async function seedCustomer(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`, [
      id,
      tenantId,
      `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    ])
    createdUserIds.push(id)
    return id
  }

  /** `pending_payment` заказ + ОРИГИНАЛЬНАЯ `create_bill`-строка `payment_operations` (см. JSDoc файла). */
  async function seedPendingOrderWithInvoice(providerRef: string): Promise<string> {
    const customerId = await seedCustomer()
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'pending_payment', NULL, 150.00, 0.00, 150.00, 'x', $5, $6)`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, tenantId, randomUUID()],
    )
    createdOrderIds.push(orderId)
    await pool.query(
      `INSERT INTO payment_operations (id, order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
       VALUES ($1, $2, 'create_bill', $3, 'mock_bank', $4, 'pending', $5)`,
      [randomUUID(), orderId, `checkout-${randomUUID()}`, providerRef, ORDER_TOTAL_DIRAM],
    )
    return orderId
  }

  function paymentConfirmedBody(providerRef: string, bankEventId = `evt-${randomUUID()}`): MockBankWebhookBody {
    return { bankEventId, providerRef, type: 'payment_confirmed', amountDiram: ORDER_TOTAL_DIRAM.toString(), occurredAt: new Date().toISOString() }
  }

  async function readOrderStatus(orderId: string): Promise<string | null> {
    const res = await pool.query<{ status: string | null }>('SELECT status FROM orders WHERE id = $1', [orderId])
    return res.rows[0]?.status ?? null
  }

  async function countLedgerRows(orderId: string): Promise<number> {
    const res = await pool.query('SELECT id FROM escrow_ledger WHERE order_id = $1', [orderId])
    return res.rowCount ?? 0
  }

  async function countPaymentOperations(orderId: string): Promise<number> {
    const res = await pool.query('SELECT id FROM payment_operations WHERE order_id = $1', [orderId])
    return res.rowCount ?? 0
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      tenantId,
      'test-payments-242',
    ])
    pharmacyId = await seedPharmacy()
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM payment_operations WHERE order_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM outbox WHERE aggregate_id = ANY($1)', [createdOrderIds])
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
      await pool.end().catch(() => undefined)
    }
  })

  it('AC1 — payment_confirmed валиден → paid_escrow, РОВНО одна hold_created запись, атомарно (обе мутации применены)', async () => {
    const providerRef = `mock_inv_${randomUUID()}`
    const orderId = await seedPendingOrderWithInvoice(providerRef)
    const body = paymentConfirmedBody(providerRef)
    const json = JSON.stringify(body)

    const res = await webhookRequest({ httpServer, providerName: 'mock_bank', json, signature: signBody(json) })

    expect(res.status).toBe(200)
    expect(await readOrderStatus(orderId)).toBe('paid_escrow')
    expect(await countLedgerRows(orderId)).toBe(1)
    const ledgerRows = await pool.query<{ entry_type: string; direction: string; amount_diram: string }>(
      'SELECT entry_type, direction, amount_diram FROM escrow_ledger WHERE order_id = $1',
      [orderId],
    )
    expect(ledgerRows.rows[0]?.entry_type).toBe('hold_created')
    expect(ledgerRows.rows[0]?.direction).toBe('debit')
    expect(BigInt(ledgerRows.rows[0]?.amount_diram ?? '0')).toBe(ORDER_TOTAL_DIRAM)
    // create_bill (фикстура) + payment_confirmed (этот вебхук) — обе мутации транзакции применены.
    expect(await countPaymentOperations(orderId)).toBe(2)
  })

  it('AC2 — тот же bankEventId повторно → 200 OK, escrow_ledger РОВНО одна запись (не две)', async () => {
    const providerRef = `mock_inv_${randomUUID()}`
    const orderId = await seedPendingOrderWithInvoice(providerRef)
    const body = paymentConfirmedBody(providerRef)
    const json = JSON.stringify(body)
    const signature = signBody(json)

    const first = await webhookRequest({ httpServer, providerName: 'mock_bank', json: json, signature: signature })
    const second = await webhookRequest({ httpServer, providerName: 'mock_bank', json: json, signature: signature })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await countLedgerRows(orderId)).toBe(1)
    expect(await readOrderStatus(orderId)).toBe('paid_escrow')
  })

  it('AC3 — тело изменено после подписи → 401 INVALID_WEBHOOK_SIGNATURE, ни одна запись БД не изменена', async () => {
    const providerRef = `mock_inv_${randomUUID()}`
    const orderId = await seedPendingOrderWithInvoice(providerRef)
    const body = paymentConfirmedBody(providerRef)
    const signedJson = JSON.stringify(body)
    const signature = signBody(signedJson)
    // Подделка: тело меняется ПОСЛЕ вычисления подписи (симулирует MITM/подмену).
    const tamperedJson = JSON.stringify({ ...body, amountDiram: (ORDER_TOTAL_DIRAM * 100n).toString() })

    const res = await webhookRequest({ httpServer, providerName: 'mock_bank', json: tamperedJson, signature: signature })

    expect(res.status).toBe(401)
    expect((res.body as ErrorBody).error.code).toBe('INVALID_WEBHOOK_SIGNATURE')
    expect(await readOrderStatus(orderId)).toBe('pending_payment')
    expect(await countLedgerRows(orderId)).toBe(0)
    expect(await countPaymentOperations(orderId)).toBe(1) // только фикстура create_bill.
  })

  it('AC4 — X-Payment-Provider неизвестен → 400 WEBHOOK_PROVIDER_UNKNOWN ДО верификации (тело синтаксически валидно, но НИКОГДА не доходит до verify()/Zod)', async () => {
    // Синтаксически валидный JSON намеренно (Fastify сам парсит `application/json` НА ТРАНСПОРТНОМ
    // уровне независимо от rawBody:true — malformed JSON дал бы 400 ОТ FASTIFY, не от use case,
    // и тест перестал бы проверять именно WEBHOOK_PROVIDER_UNKNOWN). «verify()/Zod не вызван»
    // доказывается на unit-уровне (`handle-payment-webhook.use-case.spec.ts`) счётчиком мока —
    // здесь, на HTTP-уровне, проверяется код ошибки и подпись, которая не подошла бы НИ ОДНОМУ
    // известному провайдеру, что доказывает: обработчик не дошёл до реального verify().
    const body = paymentConfirmedBody(`mock_inv_${randomUUID()}`)
    const json = JSON.stringify(body)

    const res = await webhookRequest({ httpServer, providerName: 'unknown_bank', json, signature: 'irrelevant-signature' })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('WEBHOOK_PROVIDER_UNKNOWN')
  })

  it('AC5 — два вебхука для РАЗНЫХ orderId конкурентно → оба успешны независимо, без взаимной блокировки', async () => {
    const providerRefA = `mock_inv_${randomUUID()}`
    const providerRefB = `mock_inv_${randomUUID()}`
    const orderIdA = await seedPendingOrderWithInvoice(providerRefA)
    const orderIdB = await seedPendingOrderWithInvoice(providerRefB)
    const jsonA = JSON.stringify(paymentConfirmedBody(providerRefA))
    const jsonB = JSON.stringify(paymentConfirmedBody(providerRefB))

    const started = Date.now()
    const [resA, resB] = await Promise.all([
      webhookRequest({ httpServer, providerName: 'mock_bank', json: jsonA, signature: signBody(jsonA) }),
      webhookRequest({ httpServer, providerName: 'mock_bank', json: jsonB, signature: signBody(jsonB) }),
    ])
    const elapsedMs = Date.now() - started

    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(await readOrderStatus(orderIdA)).toBe('paid_escrow')
    expect(await readOrderStatus(orderIdB)).toBe('paid_escrow')
    // Построчная, не глобальная блокировка (SRS-DOM-165/026) — оба запроса не сериализованы
    // друг за другом настолько, чтобы предположить общий мьютекс/лок на весь эндпоинт.
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('идемпотентность РЕАЛЬНОЙ конкурентностью — Promise.all двух одновременных POST с ОДНИМ bankEventId против живого Postgres', async () => {
    const providerRef = `mock_inv_${randomUUID()}`
    const orderId = await seedPendingOrderWithInvoice(providerRef)
    const json = JSON.stringify(paymentConfirmedBody(providerRef))
    const signature = signBody(json)

    const results = await Promise.all([
      webhookRequest({ httpServer, providerName: 'mock_bank', json: json, signature: signature }),
      webhookRequest({ httpServer, providerName: 'mock_bank', json: json, signature: signature }),
    ])

    for (const res of results) {
      expect(res.status).toBe(200)
    }
    expect(await countLedgerRows(orderId)).toBe(1)
    expect(await readOrderStatus(orderId)).toBe('paid_escrow')
    expect(await countPaymentOperations(orderId)).toBe(2) // create_bill + РОВНО одна payment_confirmed.
  })

  it('атомарность — искусственный сбой между markPaidEscrow и EscrowLedger.append → ОБЕ мутации откачены, order.status остаётся pending_payment', async () => {
    const providerRef = `mock_inv_${randomUUID()}`
    const orderId = await seedPendingOrderWithInvoice(providerRef)
    const body = paymentConfirmedBody(providerRef)

    const faultyUseCase = buildUseCaseWithFaultyLedger(app)
    await expect(faultyUseCase.execute(Buffer.from(JSON.stringify(body), 'utf8'), { [SIGNATURE_HEADER]: 'unused' }, 'mock_bank')).rejects.toThrow(
      'INJECTED_FAILURE_FOR_ATOMICITY_TEST',
    )

    expect(await readOrderStatus(orderId)).toBe('pending_payment')
    expect(await countLedgerRows(orderId)).toBe(0)
    // markPaidEscrow ОТКАЧЕН вместе с ledger.append — идемпотентная строка payment_operations
    // тоже отменена (ОДНА транзакция), иначе повтор с тем же bankEventId навсегда молчал бы.
    expect(await countPaymentOperations(orderId)).toBe(1)
  })
})

/**
 * Реальные порты (Postgres-backed) ИЗ РАБОТАЮЩЕГО DI-контейнера, `EscrowLedgerRepository`
 * ОБЁРНУТ декоратором, бросающим ПОСЛЕ настоящего `append()`-сигнала не дойти — здесь ПРОЩЕ:
 * бросаем ДО реального INSERT, значит и запись в ledger, и всё, что произошло РАНЬШЕ в ТОЙ ЖЕ
 * транзакции (`markPaidEscrow`, идемпотентная вставка `payment_operations`), обязаны откатиться
 * ЦЕЛИКОМ, если атомарность держится по-настоящему (тест-план тикета: «искусственный сбой
 * между markPaidEscrow и EscrowLedger.append»). `verify()` — доверенная заглушка (подпись не
 * участвует в этой проверке, только атомарность мутации), совпадает с реальным HMAC-верификатором
 * контрактно (`Result<VerifiedWebhookPayload, ...>`).
 */
function buildUseCaseWithFaultyLedger(app: INestApplication): HandlePaymentWebhookUseCase {
  const realLedger = app.get<EscrowLedgerRepository>(ESCROW_LEDGER_REPOSITORY)
  const faultyLedger: EscrowLedgerRepository = {
    ...realLedger,
    append: (_entry: EscrowLedgerEntry, _tx?: PaymentsUnitOfWorkTx): Promise<void> => {
      throw new Error('INJECTED_FAILURE_FOR_ATOMICITY_TEST')
    },
  }
  const trustingVerifierRegistry: BankWebhookVerifierRegistryPort = {
    resolve: () => ({
      verify: (rawBody) => {
        const parsed = JSON.parse(rawBody.toString('utf8')) as MockBankWebhookBody
        return {
          ok: true,
          value: { ...parsed, amountDiram: BigInt(parsed.amountDiram), occurredAt: new Date(parsed.occurredAt) },
        }
      },
    }),
  }
  return new HandlePaymentWebhookUseCase(
    trustingVerifierRegistry,
    app.get<PaymentWebhookOperationsPort>(PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY),
    faultyLedger,
    app.get<PaymentsOrdersPort>(PAYMENTS_ORDERS_PORT),
    app.get<PaymentsOutboxPort>(PAYMENTS_OUTBOX),
    app.get<PaymentsUnitOfWorkPort>(PAYMENTS_UNIT_OF_WORK),
    app.get<AuditLogPort>(AUDIT_LOG_PORT),
    app.get(LatePaymentRefundService),
    app.get(PINO_LOGGER),
  )
}
