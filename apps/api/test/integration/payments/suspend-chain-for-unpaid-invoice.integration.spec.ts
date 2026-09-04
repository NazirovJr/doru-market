/**
 * Интеграционный тест `POST /api/v1/internal/pharmacy-chains/:id/suspend-for-unpaid-invoice`
 * (EP-10, DTJ-252, TC-PAY-013 буквально из `21-module-orders-payments-escrow.md`) — реальный
 * HTTP (Supertest) → `PaymentsInternalServiceGuard` → `OnboardingFacadePort.suspendChain` →
 * `OnboardingFacadeAdapter` → `OnboardingFacade.suspendChainForUnpaidInvoice` → РЕАЛЬНЫЙ Postgres
 * `pharmacy_chains.status`. Тот же приём подключения, что `hold-payout.integration.spec.ts`
 * (DTJ-249) — прямой `Pool`, без Testcontainers (D-EP09-14/31).
 *
 * АС1 доказывается ЧЕРЕЗ `OnboardingFacade.isPharmacyActive` — ЕДИНУЮ точку, которую реально
 * читает `CheckoutUseCase` (DTJ-227/229, см. JSDoc тикета «Технический контекст») — не через
 * полный E2E чекаут-стек (корзина/каталог/склад): повторное тестирование `isPharmacyActive` →
 * `PHARMACY_SUSPENDED` уже покрыто DTJ-227/229 собственными тестами, дублировать здесь —
 * дублировать чужую ответственность (тот же принцип, что `GetOrderLedgerQuery`'s JSDoc про
 * единую точку политики). Здесь — доказательство, что ЭТА джоба-мост производит ИМЕННО то
 * условие, которое `isPharmacyActive` читает.
 *
 * `TenantContext.run(...)` вокруг КАЖДОГО Supertest-вызова (`suspendChain()` ниже) — ОБЯЗАТЕЛЕН:
 * этот тестовый харнесс не поднимает `AppModule` целиком, значит НЕ регистрирует
 * `TenantResolutionMiddleware` (она вешается ТОЛЬКО в `AppModule.configure()`), а глобальный
 * `TenantScopeGuard` (`APP_GUARD` из `TenancyModule`) всё равно активен на ЛЮБОМ маршруте,
 * включая `internal/**` — без резолвленного `TenantContext` guard отдаёт замаскированный
 * `500 INTERNAL_ERROR` ДО того, как запрос доходит до `PaymentsInternalServiceGuard`/контроллера.
 * Тот же приём, что `get-order-ledger.integration.spec.ts`/`get-payouts.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const TEST_INTERNAL_API_KEY = 'test-dtj252-internal-key'
// `??=` — не перетирает, если уже выставлен исполнителем/другим файлом того же запуска (тот же
// приём, что `applyTestEnv()` в `__tests__/test-app.ts` для DATABASE_URL/REDIS_URL).
process.env.INTERNAL_API_KEY ??= TEST_INTERNAL_API_KEY

import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

/** См. JSDoc файла — значение произвольное, `SuspendChainForUnpaidInvoiceController` его не читает. */
const TENANT_STORE: TenantContextStore = TenantContext.forTenant({
  tenantId: randomUUID(),
  slug: 'dtj252-suspend-chain-tenant',
  chainId: null,
  isNeutral: false,
})

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

interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('POST /api/v1/internal/pharmacy-chains/:id/suspend-for-unpaid-invoice (DTJ-252, TC-PAY-013)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let pool: Pool
  let onboardingFacade: OnboardingFacade
  const createdChainIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdOrderIds: string[] = []
  const createdUserIds: string[] = []
  const createdTenantIds: string[] = []

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    onboardingFacade = app.get(OnboardingFacade)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
    await ctx.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
    for (const userId of createdUserIds.splice(0)) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined)
    }
    for (const tenantId of createdTenantIds.splice(0)) {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    }
    for (const pharmacyId of createdPharmacyIds.splice(0)) {
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    }
    for (const chainId of createdChainIds.splice(0)) {
      await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    }
  })

  /** Активная сеть + активная аптека внутри неё (SRS-ADM-013: обе `active`, иначе `isPharmacyActive` уже false и до вызова). */
  async function seedActiveChainWithPharmacy(): Promise<{ chainId: string; pharmacyId: string }> {
    const chainId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $2, $3, 'active')`,
      [chainId, `DTJ-252 Chain ${chainId.slice(0, 8)}`, `TIN-${chainId.slice(0, 12)}`],
    )
    createdChainIds.push(chainId)
    const pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, 'DTJ-252 Pharmacy', 'x', 38.5, 68.7, '+992900000252', 'active')`,
      [pharmacyId, chainId],
    )
    createdPharmacyIds.push(pharmacyId)
    return { chainId, pharmacyId }
  }

  let orderNumberSeq = 0
  async function seedOrder(pharmacyId: string, status: string): Promise<string> {
    const tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj252-${tenantId.slice(0, 8)}`])
    createdTenantIds.push(tenantId)
    const customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    createdUserIds.push(customerId)
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs,
          delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'cash_courier', $5, 100.00, 0.00, 100.00, 'x', $6, gen_random_uuid())`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, status, tenantId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function chainStatusOf(chainId: string): Promise<string> {
    const result = await pool.query<{ status: string }>('SELECT status FROM pharmacy_chains WHERE id = $1', [chainId])
    const row = result.rows[0]
    if (row === undefined) throw new Error(`chainStatusOf: no row for ${chainId}`)
    return row.status
  }

  /** См. JSDoc файла — `TenantContext.run(...)` обязателен для глобального `TenantScopeGuard`. `apiKey=null` — заголовок вовсе не отправляется. */
  async function suspendChain(chainId: string, apiKey: string | null = TEST_INTERNAL_API_KEY): Promise<{ status: number; body: unknown }> {
    return TenantContext.run(TENANT_STORE, async () => {
      const req = request(httpServer).post(`/api/v1/internal/pharmacy-chains/${chainId}/suspend-for-unpaid-invoice`)
      const response = apiKey === null ? await req : await req.set('x-internal-api-key', apiKey)
      return { status: response.status, body: response.body as unknown }
    })
  }

  it('АС1: приостанавливает active сеть; isPharmacyActive флипается true→false; уже оформленный заказ НЕ отменяется', async () => {
    const { chainId, pharmacyId } = await seedActiveChainWithPharmacy()
    const orderId = await seedOrder(pharmacyId, 'confirmed')

    await expect(onboardingFacade.isPharmacyActive(pharmacyId)).resolves.toBe(true)

    const response = await suspendChain(chainId)

    expect(response.status).toBe(200)
    expect((response.body as { data: { suspended: boolean } }).data).toEqual({ suspended: true })
    await expect(chainStatusOf(chainId)).resolves.toBe('suspended')
    // Единая точка, которую реально читает CheckoutUseCase (DTJ-227/229) — новый checkout на эту сеть теперь получил бы PHARMACY_SUSPENDED.
    await expect(onboardingFacade.isPharmacyActive(pharmacyId)).resolves.toBe(false)

    const orderRow = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(orderRow.rows[0]?.status).toBe('confirmed') // НЕ отменён (буквальный текст АС1)
  })

  it('идемпотентно: повторный вызов на уже suspended сети — снова 200, не ошибка', async () => {
    const { chainId } = await seedActiveChainWithPharmacy()
    await suspendChain(chainId)

    const response = await suspendChain(chainId)

    expect(response.status).toBe(200)
    await expect(chainStatusOf(chainId)).resolves.toBe('suspended')
  })

  it('без x-internal-api-key — 401', async () => {
    const { chainId } = await seedActiveChainWithPharmacy()
    const response = await suspendChain(chainId, null)
    expect(response.status).toBe(401)
  })

  it('неверный x-internal-api-key — 401', async () => {
    const { chainId } = await seedActiveChainWithPharmacy()
    const response = await suspendChain(chainId, 'wrong-key')
    expect(response.status).toBe(401)
  })

  it('несуществующий chainId — 404 NOT_FOUND', async () => {
    const response = await suspendChain(randomUUID())
    expect(response.status).toBe(404)
    expect((response.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })
})
