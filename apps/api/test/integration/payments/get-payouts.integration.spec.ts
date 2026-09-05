/**
 * Интеграционный тест `GET /api/v1/pharmacy-accounts/:id/payouts` + `.../payouts/export`
 * (EP-10, DTJ-252, АС3/АС4/АС5) — реальный HTTP (Supertest) → `AuthGuard`/`RolesGuard` →
 * `GetPharmacyPayoutsQuery`/`ExportPayoutsCsvQuery` → `DrizzlePayoutScheduleRepository` →
 * реальный Postgres. Тот же приём подключения, что `hold-payout.integration.spec.ts` (DTJ-249).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

interface PayoutBody {
  readonly orderId: string
  readonly orderNumber: string
  readonly status: string
}
interface SuccessBody {
  readonly data: readonly PayoutBody[]
  readonly meta: { readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean; readonly limit: number } }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('GET /api/v1/pharmacy-accounts/:id/payouts(+/export) (DTJ-252)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let pool: Pool
  let jwtSigner: JwtSignerPort

  const tenantId = randomUUID()
  const chainAId = randomUUID()
  const chainBId = randomUUID()
  let pharmacyAId: string
  let pharmacyA2Id: string // вторая аптека той же сети A — для АС5 (pharmacist чужой аптеки СВОЕЙ сети)
  let customerId: string
  const createdOrderIds: string[] = []

  const tenantStore: TenantContextStore = TenantContext.forTenant({ tenantId, slug: 'dtj252-payouts-tenant', chainId: null, isNeutral: false })

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get(JWT_SIGNER)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })

    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj252p-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])

    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain A', 'Chain A LLC', $2)`, [
      chainAId,
      `tin-a-${chainAId.slice(0, 8)}`,
    ])
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain B', 'Chain B LLC', $2)`, [
      chainBId,
      `tin-b-${chainBId.slice(0, 8)}`,
    ])
    pharmacyAId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Pharmacy A', 'addr', 38.5, 68.7, '+992900000001')`,
      [pharmacyAId, chainAId],
    )
    pharmacyA2Id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Pharmacy A2', 'addr', 38.5, 68.7, '+992900000002')`,
      [pharmacyA2Id, chainAId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE chain_id IN ($1, $2)', [chainAId, chainBId])
    await pool.query('DELETE FROM pharmacy_chains WHERE id IN ($1, $2)', [chainAId, chainBId])
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
    await ctx.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  let orderNumberSeq = 0
  function nextOrderNumber(): string {
    orderNumberSeq += 1
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/gu, '')
    return `DTJ-${datePart}-${String(orderNumberSeq).padStart(5, '0')}`
  }

  async function seedPayout(pharmacyId: string, status: string): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs,
          delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'delivered', 200.00, 0.00, 200.00, 'x', $5, gen_random_uuid())`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, tenantId],
    )
    await pool.query(
      `INSERT INTO payout_schedule (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 20000, 1600, 18400, 1)`,
      [orderId, pharmacyId, status],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  function token(role: 'super_admin' | 'pharmacy_admin' | 'pharmacist', chainId: string | null, pharmacyId: string | null): string {
    return jwtSigner.sign({ sub: randomUUID(), role, tenantId: role === 'super_admin' ? null : tenantId, pharmacyId, chainId, sessionId: randomUUID() })
  }

  async function getPayouts(pharmacyId: string, bearer: string, qs = ''): Promise<{ status: number; body: SuccessBody | ErrorBody }> {
    return TenantContext.run(tenantStore, async () => {
      const response = await request(httpServer).get(`/api/v1/pharmacy-accounts/${pharmacyId}/payouts${qs}`).set('Authorization', `Bearer ${bearer}`)
      return { status: response.status, body: response.body as SuccessBody | ErrorBody }
    })
  }

  it('АС3: super_admin — список payout_schedule аптеки, курсорная мета присутствует', async () => {
    await seedPayout(pharmacyAId, 'due')
    const { status, body } = await getPayouts(pharmacyAId, token('super_admin', null, null))

    expect(status).toBe(200)
    const success = body as SuccessBody
    expect(success.data.length).toBeGreaterThanOrEqual(1)
    expect(success.meta.pagination).toMatchObject({ hasMore: false, limit: 20 })
  })

  it('АС3: filter[status][in]=due,paid — ответ содержит ТОЛЬКО строки с этими статусами', async () => {
    await seedPayout(pharmacyAId, 'due')
    await seedPayout(pharmacyAId, 'paid')
    await seedPayout(pharmacyAId, 'pending')

    const { status, body } = await getPayouts(pharmacyAId, token('super_admin', null, null), '?filter[status][in]=due,paid')

    expect(status).toBe(200)
    const statuses = (body as SuccessBody).data.map((p) => p.status)
    expect(statuses.length).toBeGreaterThanOrEqual(2)
    expect(statuses.every((s) => s === 'due' || s === 'paid')).toBe(true)
  })

  it('АС3: курсорная пагинация — limit=1 даёт hasMore=true, nextCursor непустой, вторая страница отдаёт следующую строку', async () => {
    await seedPayout(pharmacyAId, 'due')
    await seedPayout(pharmacyAId, 'due')

    const page1 = await getPayouts(pharmacyAId, token('super_admin', null, null), '?limit=1')
    expect(page1.status).toBe(200)
    const success1 = page1.body as SuccessBody
    expect(success1.data).toHaveLength(1)
    expect(success1.meta.pagination.hasMore).toBe(true)
    expect(success1.meta.pagination.nextCursor).not.toBeNull()

    const page2 = await getPayouts(pharmacyAId, token('super_admin', null, null), `?limit=1&cursor=${encodeURIComponent(success1.meta.pagination.nextCursor ?? '')}`)
    expect(page2.status).toBe(200)
    const success2 = page2.body as SuccessBody
    expect(success2.data).toHaveLength(1)
    expect(success2.data[0]?.orderId).not.toBe(success1.data[0]?.orderId)
  })

  it('pharmacy_admin ЧУЖОЙ сети (B) — 403 FORBIDDEN', async () => {
    await seedPayout(pharmacyAId, 'due')
    const { status, body } = await getPayouts(pharmacyAId, token('pharmacy_admin', chainBId, null))
    expect(status).toBe(403)
    expect((body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('pharmacy_admin своей сети (A) — 200', async () => {
    await seedPayout(pharmacyAId, 'due')
    const { status } = await getPayouts(pharmacyAId, token('pharmacy_admin', chainAId, null))
    expect(status).toBe(200)
  })

  it('АС5: pharmacist своей аптеки — 200, read-only', async () => {
    await seedPayout(pharmacyAId, 'due')
    const { status } = await getPayouts(pharmacyAId, token('pharmacist', null, pharmacyAId))
    expect(status).toBe(200)
  })

  it('АС5: pharmacist ЧУЖОЙ аптеки ТОЙ ЖЕ сети — 403 (буквальный текст АС5)', async () => {
    await seedPayout(pharmacyAId, 'due')
    const { status, body } = await getPayouts(pharmacyAId, token('pharmacist', null, pharmacyA2Id))
    expect(status).toBe(403)
    expect((body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('АС4: GET .../payouts/export?format=csv — Content-Type: text/csv, валидный CSV с заголовком', async () => {
    await seedPayout(pharmacyAId, 'due')

    const response = await TenantContext.run(tenantStore, () =>
      request(httpServer)
        .get(`/api/v1/pharmacy-accounts/${pharmacyAId}/payouts/export?format=csv`)
        .set('Authorization', `Bearer ${token('super_admin', null, null)}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    const csvText = response.text || (response.body as Buffer).toString('utf-8')
    const lines = csvText.split('\r\n')
    expect(lines[0]).toBe('orderId,orderNumber,grossAmountDiram,commissionDiram,netAmountDiram,status,dueAt,paidAt')
    expect(lines.length).toBeGreaterThan(1)
  })

  it('АС4: CSV-экспорт — pharmacy_admin чужой сети — 403 (та же политика, что список)', async () => {
    const response = await TenantContext.run(tenantStore, () =>
      request(httpServer)
        .get(`/api/v1/pharmacy-accounts/${pharmacyAId}/payouts/export?format=csv`)
        .set('Authorization', `Bearer ${token('pharmacy_admin', chainBId, null)}`),
    )
    expect(response.status).toBe(403)
  })
})
