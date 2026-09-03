/**
 * Тесты `AlifMobiProvider` (EP-10, DTJ-239, тест-план тикета) — РЕАЛЬНЫЙ Postgres для
 * `payment_operations` (тот же приём, что `mock-bank.provider.integration.spec.ts`, DTJ-238:
 * мокать сам Drizzle query-builder дало бы тест, проверяющий структуру мока, а не
 * идемпотентность `ON CONFLICT`/реальный UNIQUE, SRS-PAY-003), сетевой вызов к банку — МОК
 * (`vi.stubGlobal('fetch', ...)`, тест-план тикета: «не реальный сетевой вызов —
 * nock/аналогичный mock HTTP-клиента» — `nock` не заводится, правило 6 AGENTS.md, `fetch` —
 * встроенный глобал Node ≥18, мокается штатным `vi.stubGlobal`).
 *
 * AC2 DTJ-239 (сериализация запроса `createInvoice`/парсинг ответа на ASSUMPTION-фикстуре Alif)
 * доказывается ЗДЕСЬ через перехват аргументов `fetch` и подстановку фикстурного JSON-ответа —
 * без реального сетевого вызова.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { ConfigService } from '@nestjs/config'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { paymentOperations } from '@/db/schema/payments.js'
import { tenants } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { orders } from '@/db/schema/orders.js'
import { AlifMobiProvider } from '@/modules/payments/infrastructure/adapters/alif-mobi.provider.js'
import { NotSupportedByProviderError } from '@/modules/payments/domain/errors/not-supported-by-provider.error.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const ALIF_BASE_URL = 'https://alif.example.test'

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

function fakeConfig(overrides: Partial<EnvConfig> = {}): AppConfigService {
  const env: Partial<EnvConfig> = {
    ALIF_MOBI_API_BASE_URL: ALIF_BASE_URL,
    ALIF_MOBI_API_TOKEN: 'test-alif-token',
    BANK_INVOICE_VALIDITY_MINUTES: 15,
    ...overrides,
  }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

/** Фикстурный ответ Alifpay `POST /invoice` (research 03 §2.2, ASSUMPTION). */
function fetchJsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function fetchHttpError(status: number): Response {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response
}

describe.skipIf(!postgresAvailable)('AlifMobiProvider (DTJ-239)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let tenantId: string
  let customerId: string
  let orderId: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.id, orderId))
    await db.delete(users).where(eq(users.id, customerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
    vi.unstubAllGlobals()
  })

  beforeEach(async () => {
    tenantId = randomUUID()
    await db.insert(tenants).values({ id: tenantId, slug: `dtj239-${tenantId.slice(0, 8)}`, isNeutral: false })
    customerId = randomUUID()
    await db.insert(users).values({ id: customerId, tenantId, role: 'customer' })
    orderId = randomUUID()
    await db.insert(orders).values({
      id: orderId,
      orderNumber: `DTJ239-${randomUUID().slice(0, 8)}`,
      customerId,
      paymentMethod: 'alif_mobi',
      itemsTotalTjs: '10.00',
      deliveryFeeTjs: '0.00',
      totalAmountTjs: '10.00',
      deliveryAddress: 'x',
      tenantId,
      checkoutAttemptId: randomUUID(),
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  describe('capabilities() — AC1/SRS-PAY-007 (без сети/БД)', () => {
    it('providerName=alif_mobi, оба capability-флага false (D-02/D-10)', () => {
      const provider = new AlifMobiProvider(db, fakeConfig())
      expect(provider.capabilities()).toEqual({
        providerName: 'alif_mobi',
        supportsHoldCapture: false,
        supportsPartialRefund: false,
        maxInvoiceValidityMinutes: 15,
      })
    })
  })

  describe('createInvoice() — AC2', () => {
    it('сериализует запрос (amount/phone/webhook_url/meta), парсит ASSUMPTION-ответ Alif в InvoiceRef', async () => {
      fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'alif_bill_123', price: '5000', created_at: '2026-01-01T00:00:00.000Z' }))
      const provider = new AlifMobiProvider(db, fakeConfig())
      const idempotencyKey = `key-${randomUUID()}`

      const result = await provider.createInvoice({
        orderId,
        amountDiram: 5_000n,
        currency: 'TJS',
        idempotencyKey,
        description: 'DoruTJ order DTJ239-001',
        customerPhone: '+992900000000',
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${ALIF_BASE_URL}/invoice`)
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>).Token).toBe('test-alif-token')
      const sentBody = JSON.parse(init.body as string) as Record<string, unknown>
      expect(sentBody.amount).toBe('5000')
      expect(sentBody.phone).toBe('+992900000000')
      expect((sentBody.meta as Record<string, unknown>).orderId).toBe(orderId)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.providerRef).toBe('alif_bill_123')
      expect(result.value.qrPayload).toBe('https://checkout.alif.tj/?invoice=alif_bill_123')
      expect(result.value.expiresAt.getTime()).toBeGreaterThan(Date.now())

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.operationType).toBe('create_bill')
      expect(rows[0]?.provider).toBe('alif_mobi')
      expect(rows[0]?.providerRef).toBe('alif_bill_123')
    })

    it('SRS-PAY-003: повторный вызов с тем же idempotencyKey НЕ бьёт в сеть повторно (проверка локально first)', async () => {
      fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'alif_bill_456', price: '1000', created_at: '2026-01-01T00:00:00.000Z' }))
      const provider = new AlifMobiProvider(db, fakeConfig())
      const cmd = {
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS' as const,
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      }

      const first = await provider.createInvoice(cmd)
      const second = await provider.createInvoice(cmd)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(second.value.providerRef).toBe(first.value.providerRef)

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, cmd.idempotencyKey))
      expect(rows).toHaveLength(1)
    })

    it('банк отвечает HTTP 500 → Err(PaymentProviderError), не создаёт строку payment_operations', async () => {
      fetchMock.mockResolvedValueOnce(fetchHttpError(500))
      const provider = new AlifMobiProvider(db, fakeConfig())
      const idempotencyKey = `key-${randomUUID()}`

      const result = await provider.createInvoice({
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS',
        idempotencyKey,
        description: 'test',
        customerPhone: '+992900000000',
      })

      expect(result.ok).toBe(false)
      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(0)
    })

    it('ALIF_MOBI_API_BASE_URL не настроен → Err (не бьёт в сеть)', async () => {
      const provider = new AlifMobiProvider(db, fakeConfig({ ALIF_MOBI_API_BASE_URL: undefined }))
      const result = await provider.createInvoice({
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(result.ok).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getStatus()', () => {
    it('неизвестный providerRef → Err(PROVIDER_REF_NOT_FOUND)', async () => {
      const provider = new AlifMobiProvider(db, fakeConfig())
      const result = await provider.getStatus('alif_bill_does-not-exist')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('PROVIDER_REF_NOT_FOUND')
    })

    it('succeeded → status=paid (SRS-PAY-002: только диагностика)', async () => {
      fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'alif_bill_789', price: '2500', created_at: '2026-01-01T00:00:00.000Z' }))
      const provider = new AlifMobiProvider(db, fakeConfig())
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 2_500n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      await db.update(paymentOperations).set({ status: 'succeeded' }).where(eq(paymentOperations.providerRef, created.value.providerRef))
      const status = await provider.getStatus(created.value.providerRef)
      expect(status.ok).toBe(true)
      if (status.ok) expect(status.value.status).toBe('paid')
    })
  })

  describe('refund()', () => {
    it('серилизует запрос, парсит DONE → succeeded', async () => {
      fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'alif_bill_r1', price: '3000', created_at: '2026-01-01T00:00:00.000Z' }))
      const provider = new AlifMobiProvider(db, fakeConfig())
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 3_000n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'alif_refund_1', status: 'DONE' }))
      const refundIdempotencyKey = `refund-${randomUUID()}`
      const result = await provider.refund(created.value.providerRef, refundIdempotencyKey)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.providerRefundRef).toBe('alif_refund_1')
      expect(result.value.amountDiram).toBe(3_000n)

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, refundIdempotencyKey))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.operationType).toBe('refund')
      expect(rows[0]?.status).toBe('succeeded')
    })

    it('неизвестный providerRef → Err(PROVIDER_REF_NOT_FOUND), не бьёт в сеть', async () => {
      const provider = new AlifMobiProvider(db, fakeConfig())
      const result = await provider.refund('alif_bill_does-not-exist', `refund-${randomUUID()}`)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('PROVIDER_REF_NOT_FOUND')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('partialRefund() — AC4 DTJ-238 (симметрично для реальных адаптеров)', () => {
    it('ВСЕГДА Err(NotSupportedByProviderError), без сети/БД', async () => {
      const provider = new AlifMobiProvider(db, fakeConfig())
      const result = await provider.partialRefund('alif_bill_anything', 100n, 'idem-key')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NotSupportedByProviderError)
        expect(result.error.code).toBe('NOT_SUPPORTED_BY_PROVIDER')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
