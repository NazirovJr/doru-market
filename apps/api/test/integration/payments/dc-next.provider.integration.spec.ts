/**
 * Тесты `DcNextProvider` (EP-10, DTJ-239) — зеркало `alif-mobi.provider.integration.spec.ts`
 * (см. его JSDoc — тот же приём: реальный Postgres для `payment_operations`, `fetch` замокан
 * `vi.stubGlobal`, не реальный сетевой вызов).
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
import { DcNextProvider } from '@/modules/payments/infrastructure/adapters/dc-next.provider.js'
import { NotSupportedByProviderError } from '@/modules/payments/domain/errors/not-supported-by-provider.error.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const DC_NEXT_BASE_URL = 'https://dc-next.example.test'

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
    DC_NEXT_API_BASE_URL: DC_NEXT_BASE_URL,
    DC_NEXT_API_TOKEN: 'test-dc-token',
    BANK_INVOICE_VALIDITY_MINUTES: 15,
    ...overrides,
  }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

function fetchJsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

describe.skipIf(!postgresAvailable)('DcNextProvider (DTJ-239)', () => {
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
    await db.insert(tenants).values({ id: tenantId, slug: `dtj239dc-${tenantId.slice(0, 8)}`, isNeutral: false })
    customerId = randomUUID()
    await db.insert(users).values({ id: customerId, tenantId, role: 'customer' })
    orderId = randomUUID()
    await db.insert(orders).values({
      id: orderId,
      orderNumber: `DTJ239DC-${randomUUID().slice(0, 8)}`,
      customerId,
      paymentMethod: 'dc_next',
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

  it('capabilities() — providerName=dc_next, оба флага false (AC1/SRS-PAY-007)', () => {
    const provider = new DcNextProvider(db, fakeConfig())
    expect(provider.capabilities()).toEqual({
      providerName: 'dc_next',
      supportsHoldCapture: false,
      supportsPartialRefund: false,
      maxInvoiceValidityMinutes: 15,
    })
  })

  it('createInvoice() — AC2: сериализует запрос, парсит ASSUMPTION-ответ в InvoiceRef, персистит payment_operations', async () => {
    fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'dc_bill_123', price: '4200', created_at: '2026-01-01T00:00:00.000Z' }))
    const provider = new DcNextProvider(db, fakeConfig())
    const idempotencyKey = `key-${randomUUID()}`

    const result = await provider.createInvoice({
      orderId,
      amountDiram: 4_200n,
      currency: 'TJS',
      idempotencyKey,
      description: 'DoruTJ order DTJ239DC-001',
      customerPhone: '+992900000001',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${DC_NEXT_BASE_URL}/invoice`)
    expect((init.headers as Record<string, string>).Token).toBe('test-dc-token')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.providerRef).toBe('dc_bill_123')
    expect(result.value.qrPayload).toBe('https://pay.dc.tj/?invoice=dc_bill_123')

    const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.provider).toBe('dc_next')
  })

  it('SRS-PAY-003: повторный вызов с тем же idempotencyKey не бьёт в сеть повторно', async () => {
    fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'dc_bill_456', price: '900', created_at: '2026-01-01T00:00:00.000Z' }))
    const provider = new DcNextProvider(db, fakeConfig())
    const cmd = {
      orderId,
      amountDiram: 900n,
      currency: 'TJS' as const,
      idempotencyKey: `key-${randomUUID()}`,
      description: 'test',
      customerPhone: '+992900000001',
    }

    const first = await provider.createInvoice(cmd)
    const second = await provider.createInvoice(cmd)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.value.providerRef).toBe(first.value.providerRef)
    }
  })

  it('getStatus() — неизвестный providerRef → Err(PROVIDER_REF_NOT_FOUND)', async () => {
    const provider = new DcNextProvider(db, fakeConfig())
    const result = await provider.getStatus('dc_bill_does-not-exist')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_REF_NOT_FOUND')
  })

  it('refund() — сериализует запрос, парсит DONE → succeeded', async () => {
    fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'dc_bill_r1', price: '1500', created_at: '2026-01-01T00:00:00.000Z' }))
    const provider = new DcNextProvider(db, fakeConfig())
    const created = await provider.createInvoice({
      orderId,
      amountDiram: 1_500n,
      currency: 'TJS',
      idempotencyKey: `key-${randomUUID()}`,
      description: 'test',
      customerPhone: '+992900000001',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    fetchMock.mockResolvedValueOnce(fetchJsonOk({ id: 'dc_refund_1', status: 'DONE' }))
    const refundIdempotencyKey = `refund-${randomUUID()}`
    const result = await provider.refund(created.value.providerRef, refundIdempotencyKey)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.providerRefundRef).toBe('dc_refund_1')
    expect(result.value.amountDiram).toBe(1_500n)
  })

  it('partialRefund() — ВСЕГДА Err(NotSupportedByProviderError), без сети', async () => {
    const provider = new DcNextProvider(db, fakeConfig())
    const result = await provider.partialRefund('dc_bill_anything', 100n, 'idem-key')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeInstanceOf(NotSupportedByProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
