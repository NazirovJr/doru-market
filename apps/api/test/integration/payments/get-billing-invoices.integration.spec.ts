/**
 * Интеграционный тест `GET /api/v1/pharmacy-accounts/:id/billing-invoices` (EP-10, DTJ-252, п.5)
 * — реальный HTTP (Supertest) → `AuthGuard`/`RolesGuard` → `GetBillingInvoicesQuery` →
 * `DrizzlePlatformBillingInvoiceRepository` → реальный Postgres. Тот же приём подключения, что
 * `get-payouts.integration.spec.ts`.
 *
 * `TenantContext.run(...)` вокруг КАЖДОГО Supertest-вызова — ОБЯЗАТЕЛЕН, не декоративный: этот
 * тестовый харнесс (`createTestApp()`) не поднимает `AppModule` целиком, а значит НЕ регистрирует
 * `TenantResolutionMiddleware` (она вешается ТОЛЬКО в `AppModule.configure()`, `app.module.ts`,
 * не в `TenancyModule` самом по себе) — глобальный `TenantScopeGuard` (`APP_GUARD` из
 * `TenancyModule`) при этом всё равно активен на КАЖДОМ маршруте и требует резолвленный
 * `TenantContext`, иначе отдаёт замаскированный `500 INTERNAL_ERROR` («tenant context not
 * initialized») ДО того, как запрос вообще доходит до контроллера — контроллер этого модуля НЕ
 * читает `TenantContext` сам (сеть/аптека не тенант-скоуп), но guard требует его наличия
 * (см. её JSDoc «Шаг 1») для ЛЮБОГО маршрута без исключения. Тот же приём, что
 * `get-order-ledger.integration.spec.ts`/`get-payouts.integration.spec.ts`.
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

interface InvoiceBody {
  readonly id: string
  readonly status: string
}
interface SuccessBody {
  readonly data: readonly InvoiceBody[]
  readonly meta: { readonly pagination: { readonly hasMore: boolean } }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('GET /api/v1/pharmacy-accounts/:id/billing-invoices (DTJ-252)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let pool: Pool
  let jwtSigner: JwtSignerPort

  const chainAId = randomUUID()
  const chainBId = randomUUID()
  let pharmacyAId: string
  const createdInvoiceIds: string[] = []

  /** См. JSDoc файла — `TenantScopeGuard` требует резолвленный `TenantContext` на ЛЮБОМ маршруте; этот контроллер сам его не читает, значение — произвольное. */
  const tenantStore: TenantContextStore = TenantContext.forTenant({
    tenantId: randomUUID(),
    slug: 'dtj252-billing-invoices-tenant',
    chainId: null,
    isNeutral: false,
  })

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get(JWT_SIGNER)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })

    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain A', 'Chain A LLC', $2)`, [
      chainAId,
      `tin-bi-a-${chainAId.slice(0, 8)}`,
    ])
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain B', 'Chain B LLC', $2)`, [
      chainBId,
      `tin-bi-b-${chainBId.slice(0, 8)}`,
    ])
    pharmacyAId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Pharmacy A', 'addr', 38.5, 68.7, '+992900000003')`,
      [pharmacyAId, chainAId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE chain_id IN ($1, $2)', [chainAId, chainBId])
    await pool.query('DELETE FROM pharmacy_chains WHERE id IN ($1, $2)', [chainAId, chainBId])
    await pool.end().catch(() => undefined)
    await ctx.close()
  })

  afterEach(async () => {
    for (const invoiceId of createdInvoiceIds.splice(0)) {
      await pool.query('DELETE FROM platform_billing_invoices WHERE id = $1', [invoiceId]).catch(() => undefined)
    }
  })

  async function seedInvoice(chainId: string, status: string): Promise<string> {
    const invoiceId = randomUUID()
    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const periodEnd = new Date()
    await pool.query(
      `INSERT INTO platform_billing_invoices (id, chain_id, invoice_type, status, period_start, period_end, subtotal_diram, vat_diram, total_diram)
       VALUES ($1, $2, 'cash_courier_commission', $3, $4, $5, 10000, 1400, 11400)`,
      [invoiceId, chainId, status, periodStart, periodEnd],
    )
    createdInvoiceIds.push(invoiceId)
    return invoiceId
  }

  function token(role: 'super_admin' | 'pharmacy_admin' | 'pharmacist', chainId: string | null): string {
    return jwtSigner.sign({ sub: randomUUID(), role, tenantId: null, pharmacyId: null, chainId, sessionId: randomUUID() })
  }

  async function getInvoices(pharmacyId: string, bearer: string): Promise<{ status: number; body: SuccessBody | ErrorBody }> {
    return TenantContext.run(tenantStore, async () => {
      const response = await request(httpServer).get(`/api/v1/pharmacy-accounts/${pharmacyId}/billing-invoices`).set('Authorization', `Bearer ${bearer}`)
      return { status: response.status, body: response.body as SuccessBody | ErrorBody }
    })
  }

  it('super_admin — список инвойсов сети, курсорная мета присутствует', async () => {
    await seedInvoice(chainAId, 'issued')
    const { status, body } = await getInvoices(pharmacyAId, token('super_admin', null))

    expect(status).toBe(200)
    const success = body as SuccessBody
    expect(success.data.length).toBeGreaterThanOrEqual(1)
    expect(success.meta.pagination).toBeDefined()
  })

  it('pharmacy_admin своей сети (A) — 200', async () => {
    await seedInvoice(chainAId, 'issued')
    const { status } = await getInvoices(pharmacyAId, token('pharmacy_admin', chainAId))
    expect(status).toBe(200)
  })

  it('pharmacy_admin ЧУЖОЙ сети (B) — 403 FORBIDDEN', async () => {
    await seedInvoice(chainAId, 'issued')
    const { status, body } = await getInvoices(pharmacyAId, token('pharmacy_admin', chainBId))
    expect(status).toBe(403)
    expect((body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('pharmacist — 403 (билинг сети НЕ read-only отдельной аптеке, в отличие от payouts)', async () => {
    const { status } = await getInvoices(pharmacyAId, token('pharmacist', null))
    expect(status).toBe(403)
  })

  it('несуществующая аптека, super_admin — пустой список, не ошибка', async () => {
    const { status, body } = await getInvoices(randomUUID(), token('super_admin', null))
    expect(status).toBe(200)
    expect((body as SuccessBody).data).toEqual([])
  })
})
