/**
 * `PharmacyTerminalQueueController` — Supertest интеграция (DTJ-301, EP-12, модуль 24 «Терминал
 * фармацевта») против РЕАЛЬНЫХ Postgres/Redis (D-EP09-14, тот же `createTestApp()`, что
 * `checkout.controller.integration.spec.ts`/`retry-payment.controller.integration.spec.ts`).
 *
 * Тест-план тикета: TC-PHT-001 (accept успех), TC-PHT-002 (двойной accept),
 * TC-PHT-003 (reclaim), TC-PHT-005a/TC-PHT-030 (агрегация сети pharmacy_admin, межтенантная/
 * межсетевая изоляция), TC-PHT-023 (КОНКУРЕНТНЫЙ accept с двух «терминалов» — РЕАЛЬНЫЕ
 * одновременные HTTP-запросы через `Promise.all`, `SELECT ... FOR UPDATE` сериализует на живом
 * Postgres, не мок).
 *
 * Заказы сеются НАПРЯМУЮ SQL (тот же приём, что `retry-payment.controller.integration.spec.ts` —
 * состояние `processing`/`paid_escrow` с конкретным `assigned_pharmacist_id` недостижимо обычным
 * HTTP-путём без полного checkout+accept, что усложнило бы КАЖДЫЙ тест). `order_items` НЕ сеются
 * (см. `retry-payment...spec.ts` — тот же приём: `itemsCount=0` — валидное, проверяемое значение,
 * сеять `medicines`/`pharmacy_inventory` ради счётчика не требуется).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: Record<string, unknown>
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface AcceptBody {
  readonly id: string
  readonly status: string
  readonly slaDeadlineAt: string
  readonly assignedPharmacistId: string
}
interface ReclaimBody {
  readonly id: string
  readonly assignedPharmacistId: string
  readonly slaDeadlineAt: string | null
}
interface QueueItemBody {
  readonly id: string
  readonly pharmacyId?: string
  readonly status: string
  readonly assignedPharmacistId: string | null
}

const TENANT_ID = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5'

let orderNumberSeq = 0
function nextOrderNumber(): string {
  orderNumberSeq += 1
  return `DTJ-260906-${String(orderNumberSeq).padStart(5, '0')}`
}

describe.skipIf(!postgresAvailable)('PharmacyTerminalQueueController — Supertest integration (DTJ-301)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let ownChainId: string
  let foreignChainId: string
  let pharmacyA: string
  let pharmacyB: string
  let pharmacyForeign: string
  const createdUserIds: string[] = []
  const createdOrderIds: string[] = []
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [id, name, `${name} LLC`, `TIN-DTJ301-${randomUUID().slice(0, 8)}`],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(chainId: string, name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str. 301', 38.5598, 68.7870, '+992900000301', 'active')`,
      [id, chainId, name],
    )
    createdPharmacyIds.push(id)
    return id
  }

  async function seedUser(role: 'customer' | 'pharmacist' | 'pharmacy_admin', fullName: string | null = null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active, full_name) VALUES ($1, $2, $3, $4, true, $5)`,
      [id, TENANT_ID, `+99293${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`, role, fullName],
    )
    createdUserIds.push(id)
    return id
  }

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  interface SeedOrderParams {
    readonly pharmacyId: string
    readonly status: 'paid_escrow' | 'confirmed' | 'processing'
    readonly customerId: string
    readonly assignedPharmacistId?: string | null
    readonly slaDeadlineAt?: Date | null
    readonly processingStartedAt?: Date | null
  }

  async function seedOrder(params: SeedOrderParams): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, payment_transaction_id,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id,
          checkout_attempt_id, assigned_pharmacist_id, sla_deadline_at, processing_started_at)
       VALUES ($1, $2, $3, $4, 'alif_mobi', $5, 'mock_txn_301', 100.00, 0.00, 100.00, 'x', $6, $7, $8, $9, $10)`,
      [
        id,
        nextOrderNumber(),
        params.customerId,
        params.pharmacyId,
        params.status,
        TENANT_ID,
        randomUUID(),
        params.assignedPharmacistId ?? null,
        params.slaDeadlineAt ?? null,
        params.processingStartedAt ?? null,
      ],
    )
    createdOrderIds.push(id)
    return id
  }

  function acceptRequest(orderId: string, token: string, idempotencyKey: string): request.Test {
    return request(httpServer)
      .post(`/api/v1/orders/${orderId}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
  }

  interface ReclaimRequestParams {
    readonly orderId: string
    readonly token: string
    readonly idempotencyKey: string
    readonly body: Record<string, unknown>
  }

  /** Объект-параметр (C5, `max-params` ≤3) — `acceptRequest` обходится 3 позиционными, `reclaim` несёт ЕЩЁ и тело. */
  function reclaimRequest({ orderId, token, idempotencyKey, body }: ReclaimRequestParams): request.Test {
    return request(httpServer)
      .post(`/api/v1/orders/${orderId}/reclaim`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
  }

  /** `sort=priority` ОБЯЗАТЕЛЕН (`CursorQueryPipe` — валидирует против `z.enum(['priority'])`,
   *  дефолт разделяемого пайпа `created_at` в этот enum не входит) — `extraQuery` добавляется через `&`. */
  function queueRequest(token: string, extraQuery = ''): request.Test {
    const query = extraQuery.length > 0 ? `?sort=priority&${extraQuery.replace(/^\?/, '')}` : '?sort=priority'
    return request(httpServer).get(`/api/v1/orders${query}`).set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      'test-orders-301',
    ])
    ownChainId = await seedChain('Test Chain DTJ-301 Own')
    foreignChainId = await seedChain('Test Chain DTJ-301 Foreign')
    pharmacyA = await seedPharmacy(ownChainId, 'Pharmacy A (DTJ-301)')
    pharmacyB = await seedPharmacy(ownChainId, 'Pharmacy B (DTJ-301)')
    pharmacyForeign = await seedPharmacy(foreignChainId, 'Pharmacy Foreign (DTJ-301)')

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM idempotency_keys WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrderIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('TC-PHT-001 — заказ paid_escrow, свободен, accept → 200, processing, slaDeadlineAt=now+pickupSla, assignedPharmacistId=A', async () => {
    const customerId = await seedUser('customer')
    const pharmacistA = await seedUser('pharmacist', 'Фарзона М.')
    const orderId = await seedOrder({ pharmacyId: pharmacyA, status: 'paid_escrow', customerId })
    const token = sign({ sub: pharmacistA, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await acceptRequest(orderId, token, randomUUID())

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<AcceptBody>).data
    expect(body.id).toBe(orderId)
    expect(body.status).toBe('processing')
    expect(body.assignedPharmacistId).toBe(pharmacistA)
    expect(new Date(body.slaDeadlineAt).getTime()).toBeGreaterThan(Date.now())

    const row = await pool.query<{ status: string; assigned_pharmacist_id: string }>(
      'SELECT status, assigned_pharmacist_id FROM orders WHERE id = $1',
      [orderId],
    )
    expect(row.rows[0]?.status).toBe('processing')
    expect(row.rows[0]?.assigned_pharmacist_id).toBe(pharmacistA)
  })

  it('TC-PHT-002 — заказ уже принят A, B вызывает accept ПОСЛЕ ответа A → 409 ORDER_ALREADY_CLAIMED, details.assignedPharmacistId=A, статус не откатывается', async () => {
    const customerId = await seedUser('customer')
    const pharmacistA = await seedUser('pharmacist', 'Фарзона М.')
    const pharmacistB = await seedUser('pharmacist', 'Бахтиёр С.')
    const orderId = await seedOrder({ pharmacyId: pharmacyA, status: 'paid_escrow', customerId })
    const tokenA = sign({ sub: pharmacistA, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })
    const tokenB = sign({ sub: pharmacistB, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const resA = await acceptRequest(orderId, tokenA, randomUUID())
    expect(resA.status).toBe(200)

    const resB = await acceptRequest(orderId, tokenB, randomUUID())

    expect(resB.status).toBe(409)
    const errorBody = resB.body as ErrorBody
    expect(errorBody.error.code).toBe('ORDER_ALREADY_CLAIMED')
    expect(errorBody.error.details?.assignedPharmacistId).toBe(pharmacistA)
    expect(errorBody.error.details?.assignedPharmacistName).toBe('Фарзона М.')

    const row = await pool.query<{ status: string; assigned_pharmacist_id: string }>(
      'SELECT status, assigned_pharmacist_id FROM orders WHERE id = $1',
      [orderId],
    )
    expect(row.rows[0]?.status).toBe('processing')
    expect(row.rows[0]?.assigned_pharmacist_id).toBe(pharmacistA)
  })

  it('TC-PHT-003 — заказ в работе у A, B вызывает reclaim(shift_change) → 200, assignedPharmacistId=B, slaDeadlineAt НЕ изменился', async () => {
    const customerId = await seedUser('customer')
    const pharmacistA = await seedUser('pharmacist')
    const pharmacistB = await seedUser('pharmacist')
    const slaDeadlineAt = new Date(Date.now() + 5 * 60_000)
    const orderId = await seedOrder({
      pharmacyId: pharmacyA,
      status: 'processing',
      customerId,
      assignedPharmacistId: pharmacistA,
      slaDeadlineAt,
      processingStartedAt: new Date(),
    })
    const tokenB = sign({ sub: pharmacistB, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await reclaimRequest({ orderId, token: tokenB, idempotencyKey: randomUUID(), body: { reason: 'shift_change' } })

    expect(res.status).toBe(200)
    const body = (res.body as SuccessBody<ReclaimBody>).data
    expect(body.assignedPharmacistId).toBe(pharmacistB)
    expect(new Date(body.slaDeadlineAt ?? '').getTime()).toBe(slaDeadlineAt.getTime())

    const row = await pool.query<{ assigned_pharmacist_id: string; sla_deadline_at: Date; status: string }>(
      'SELECT assigned_pharmacist_id, sla_deadline_at, status FROM orders WHERE id = $1',
      [orderId],
    )
    expect(row.rows[0]?.assigned_pharmacist_id).toBe(pharmacistB)
    expect(row.rows[0]?.status).toBe('processing') // reclaim НЕ трогает статус
    expect(new Date(row.rows[0]?.sla_deadline_at ?? '').getTime()).toBe(slaDeadlineAt.getTime())
  })

  it('без заголовка Idempotency-Key на accept → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const customerId = await seedUser('customer')
    const pharmacistA = await seedUser('pharmacist')
    const orderId = await seedOrder({ pharmacyId: pharmacyA, status: 'paid_escrow', customerId })
    const token = sign({ sub: pharmacistA, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await request(httpServer).post(`/api/v1/orders/${orderId}/accept`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('TC-PHT-030/SRS-PHT-005a — pharmacy_admin БЕЗ filter[pharmacyId] → заказы ВСЕХ точек своей сети, meta.groupedBy присутствует, ЧУЖАЯ сеть отсутствует', async () => {
    const customerId = await seedUser('customer')
    const admin = await seedUser('pharmacy_admin')
    const orderInA = await seedOrder({ pharmacyId: pharmacyA, status: 'paid_escrow', customerId })
    const orderInB = await seedOrder({ pharmacyId: pharmacyB, status: 'paid_escrow', customerId })
    const orderInForeign = await seedOrder({ pharmacyId: pharmacyForeign, status: 'paid_escrow', customerId })
    const token = sign({ sub: admin, role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await queueRequest(token)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<QueueItemBody[]>
    const ids = body.data.map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining([orderInA, orderInB]))
    expect(ids).not.toContain(orderInForeign)
    expect(body.meta?.groupedBy).toBeDefined()
    const groupedBy = body.meta?.groupedBy as { pharmacyId: Record<string, string[]> }
    expect(groupedBy.pharmacyId[pharmacyA]).toContain(orderInA)
    expect(groupedBy.pharmacyId[pharmacyB]).toContain(orderInB)
    expect(groupedBy.pharmacyId[pharmacyForeign]).toBeUndefined()
  })

  it('pharmacy_admin С filter[pharmacyId] ЧУЖОЙ сети → 403 (межсетевая изоляция)', async () => {
    const admin = await seedUser('pharmacy_admin')
    const token = sign({ sub: admin, role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const res = await queueRequest(token, `?filter[pharmacyId]=${pharmacyForeign}`)

    expect(res.status).toBe(403)
  })

  it('TC-PHT-023 — КОНКУРЕНТНЫЙ accept с двух «терминалов» (реальные одновременные HTTP-запросы) → ровно один 200, второй 409, НЕТ состояния «оба приняли»', async () => {
    const customerId = await seedUser('customer')
    const pharmacistA = await seedUser('pharmacist')
    const pharmacistB = await seedUser('pharmacist')
    const orderId = await seedOrder({ pharmacyId: pharmacyA, status: 'paid_escrow', customerId })
    const tokenA = sign({ sub: pharmacistA, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })
    const tokenB = sign({ sub: pharmacistB, role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: pharmacyA, chainId: ownChainId })

    const [resA, resB] = await Promise.all([
      acceptRequest(orderId, tokenA, randomUUID()),
      acceptRequest(orderId, tokenB, randomUUID()),
    ])

    const statuses = [resA.status, resB.status].sort((a, b) => a - b)
    expect(statuses).toEqual([200, 409])
    const winner = resA.status === 200 ? resA : resB
    const loser = resA.status === 200 ? resB : resA
    expect((loser.body as ErrorBody).error.code).toBe('ORDER_ALREADY_CLAIMED')
    const winnerId = (winner.body as SuccessBody<AcceptBody>).data.assignedPharmacistId
    expect([pharmacistA, pharmacistB]).toContain(winnerId)

    const row = await pool.query<{ status: string; assigned_pharmacist_id: string }>(
      'SELECT status, assigned_pharmacist_id FROM orders WHERE id = $1',
      [orderId],
    )
    expect(row.rows[0]?.status).toBe('processing')
    expect(row.rows[0]?.assigned_pharmacist_id).toBe(winnerId)
  })
})
