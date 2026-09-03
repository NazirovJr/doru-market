/**
 * Интеграционный тест `GET /api/v1/orders/:id/ledger` (EP-10, DTJ-248, SRS-PAY-016) — реальный
 * HTTP (Supertest) → `AuthGuard`/`RolesGuard` → `GetOrderLedgerQuery` → `EscrowLedgerRepository`/
 * `OrdersReadOnlyAdapter` → реальный Postgres. Тот же приём подключения, что `escrow-ledger.
 * repository.integration.spec.ts` (DTJ-240) — прямой `Pool`, без Testcontainers (D-EP09-14/31).
 *
 * Сценарий («сеть» = `pharmacy_chains`, оба ниже — под ОДНИМ нейтральным тенантом, чтобы AC3
 * («чужая сеть») было чем проверить в принципе — см. JSDoc `orders-facade.port.ts`
 * `pharmacyChainId` про необходимость именно внутритенантного случая):
 *   - 1 тенант (обычный, не singleton-нейтральный — `ux_tenants_single_neutral` разрешает
 *     ровно одну строку `is_neutral=true` в БД, см. комментарий у INSERT ниже), 2
 *     `pharmacy_chains` (A, B), по 1 `pharmacies` в каждой.
 *   - Заказ принадлежит аптеке сети A.
 *   - `super_admin` (не привязан к тенанту, SRS-TEN-010) — видит всё (AC1).
 *   - `pharmacy_admin` сети A — видит только `captured_to_pharmacy`/`platform_fee_captured`,
 *     без `paymentTransactionRef`/`hold_created` (AC2).
 *   - `pharmacy_admin` сети B — `403` (AC3, SRS-NFR-009: внутритенантный IDOR).
 *   - Отдельный заказ с ИСКУССТВЕННЫМ расхождением — `meta.isBalanced === false` (AC4).
 *   - Чужой ТЕНАНТ (другой резолвленный `TenantContext`) — `404`, не `403` (SRS-API-046,
 *     буквальное требование задания — «обращение к заказу чужого тенанта обязано вернуть 404»).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { createTestApp, type TestApp } from './__tests__/ledger-test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
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

interface LedgerEntryBody {
  readonly entryType: string
  readonly direction: string
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly paymentTransactionRef?: string | null
}
interface SuccessBody {
  readonly data: readonly LedgerEntryBody[]
  readonly meta: { readonly isBalanced: boolean }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('GET /api/v1/orders/:id/ledger (DTJ-248)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let pool: Pool
  let ledgerRepository: EscrowLedgerRepository
  let jwtSigner: JwtSignerPort

  const tenantId = randomUUID()
  const chainAId = randomUUID()
  const chainBId = randomUUID()
  let pharmacyAId: string
  let customerId: string
  const createdOrderIds: string[] = []

  const tenantStore: TenantContextStore = TenantContext.forTenant({
    tenantId,
    slug: 'dtj248-tenant',
    chainId: null,
    isNeutral: false,
  })

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    ledgerRepository = app.get(ESCROW_LEDGER_REPOSITORY)
    jwtSigner = app.get(JWT_SIGNER)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })

    // `is_neutral=false` (НЕ `true`): `ux_tenants_single_neutral` — в БД разрешена РОВНО одна
    // строка `is_neutral=true` (сид `0021_seed_neutral_tenant.sql`), СВОЙ второй неутральный
    // тенант завести нельзя. Для этого теста семантика "нейтральности" не важна — важно, что
    // ДВЕ разные `pharmacy_chains` сосуществуют под ОДНИМ тенантом (AC3), а её обычный тенант
    // это тоже допускает (сама схема НЕ навязывает связь "тенант ⇒ ровно одна сеть" на уровне
    // FK/CHECK — это бизнес-правило онбординга, вне периметра DTJ-248).
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, 'dtj248-tenant-' + tenantId.slice(0, 8)])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])

    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain A', 'Chain A LLC', $2)`,
      [chainAId, `tin-a-${chainAId.slice(0, 8)}`],
    )
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain B', 'Chain B LLC', $2)`,
      [chainBId, `tin-b-${chainBId.slice(0, 8)}`],
    )
    pharmacyAId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone)
       VALUES ($1, $2, 'Pharmacy A', 'addr', 38.5, 68.7, '+992900000001')`,
      [pharmacyAId, chainAId],
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
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  /**
   * `OrderNumber.parse` (`shared-kernel/domain/value-objects/order-number.vo.ts`) требует
   * СТРОГИЙ формат `DTJ-YYMMDD-NNNNN` — `OrdersFacadeAdapter.getOrderById` теперь делегирует
   * реальному `OrdersFacade`/`DrizzleOrderRepository.hydrate` (DTJ-242 приземлился параллельно),
   * который парсит `order_number` и БРОСАЕТ при невалидном формате (найдено живым прогоном
   * этого файла после DTJ-242 — раньше, с временным `OrdersReadOnlyAdapter` DTJ-248, поле не
   * парсилось вовсе). Счётчик — уникальность в пределах файла, без реального Redis-генератора.
   */
  let orderNumberSeq = 0
  function nextOrderNumber(): string {
    orderNumberSeq += 1
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/gu, '')
    return `DTJ-${datePart}-${String(orderNumberSeq).padStart(5, '0')}`
  }

  async function seedOrder(): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs,
          delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'delivered', 100.00, 0.00, 100.00, 'x', $5, gen_random_uuid())`,
      [orderId, nextOrderNumber(), customerId, pharmacyAId, tenantId],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function appendEntry(input: {
    orderId: string
    entryType: EscrowLedgerEntry['entryType']
    direction: EscrowLedgerEntry['direction']
    amountDiram: bigint
    paymentTransactionRef: string | null
  }): Promise<void> {
    await ledgerRepository.append(
      EscrowLedgerEntry.create({
        orderId: input.orderId,
        entryType: input.entryType,
        direction: input.direction,
        amountDiram: Money.fromDiram(input.amountDiram),
        paymentTransactionRef: input.paymentTransactionRef,
        reason: null,
        actorUserId: null,
      }),
    )
  }

  async function seedBalancedOrder(): Promise<string> {
    const orderId = await seedOrder()
    await appendEntry({ orderId, entryType: 'hold_created', direction: 'debit', amountDiram: 10_000n, paymentTransactionRef: 'bank-tx-dtj248' })
    await appendEntry({ orderId, entryType: 'platform_fee_captured', direction: 'credit', amountDiram: 800n, paymentTransactionRef: null })
    await appendEntry({ orderId, entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: 9_200n, paymentTransactionRef: null })
    return orderId
  }

  function token(role: 'super_admin' | 'pharmacy_admin', chainId: string | null): string {
    return jwtSigner.sign({
      sub: randomUUID(),
      role,
      tenantId: role === 'super_admin' ? null : tenantId,
      pharmacyId: null,
      chainId,
      sessionId: randomUUID(),
    })
  }

  async function getLedger(orderId: string, bearer: string): Promise<{ status: number; body: SuccessBody | ErrorBody }> {
    return TenantContext.run(tenantStore, async () => {
      const response = await request(httpServer).get(`/api/v1/orders/${orderId}/ledger`).set('Authorization', `Bearer ${bearer}`)
      return { status: response.status, body: response.body as SuccessBody | ErrorBody }
    })
  }

  it('AC1: super_admin — все записи, все поля, включая paymentTransactionRef', async () => {
    const orderId = await seedBalancedOrder()
    const { status, body } = await getLedger(orderId, token('super_admin', null))

    expect(status).toBe(200)
    const success = body as SuccessBody
    expect(success.data).toHaveLength(3)
    expect(success.data.map((e) => e.entryType)).toEqual(['hold_created', 'platform_fee_captured', 'captured_to_pharmacy'])
    expect(success.data[0]?.paymentTransactionRef).toBe('bank-tx-dtj248')
    expect(success.meta.isBalanced).toBe(true)
  })

  it('AC2: pharmacy_admin сети A — только captured_to_pharmacy/platform_fee_captured, без paymentTransactionRef/hold_created', async () => {
    const orderId = await seedBalancedOrder()
    const { status, body } = await getLedger(orderId, token('pharmacy_admin', chainAId))

    expect(status).toBe(200)
    const success = body as SuccessBody
    expect(success.data).toHaveLength(2)
    expect(success.data.map((e) => e.entryType).sort()).toEqual(['captured_to_pharmacy', 'platform_fee_captured'])
    for (const entry of success.data) {
      expect(entry).not.toHaveProperty('paymentTransactionRef')
    }
    expect(success.meta.isBalanced).toBe(true)
  })

  it('AC3: pharmacy_admin ЧУЖОЙ сети (B) — 403 FORBIDDEN', async () => {
    const orderId = await seedBalancedOrder()
    const { status, body } = await getLedger(orderId, token('pharmacy_admin', chainBId))

    expect(status).toBe(403)
    expect((body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('AC4: искусственно нарушенный баланс — meta.isBalanced=false, рассчитано на полном наборе независимо от ролевой фильтрации', async () => {
    const orderId = await seedOrder()
    await appendEntry({ orderId, entryType: 'hold_created', direction: 'debit', amountDiram: 10_000n, paymentTransactionRef: 'bank-tx-dtj248-imbalanced' })
    await appendEntry({ orderId, entryType: 'platform_fee_captured', direction: 'credit', amountDiram: 800n, paymentTransactionRef: null })
    // недостаёт 200 diram — искусственное расхождение (AC4)
    await appendEntry({ orderId, entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: 9_000n, paymentTransactionRef: null })

    const superAdminView = await getLedger(orderId, token('super_admin', null))
    expect(superAdminView.status).toBe(200)
    expect((superAdminView.body as SuccessBody).meta.isBalanced).toBe(false)

    const pharmacyAdminView = await getLedger(orderId, token('pharmacy_admin', chainAId))
    expect(pharmacyAdminView.status).toBe(200)
    expect((pharmacyAdminView.body as SuccessBody).meta.isBalanced).toBe(false)
  })

  it('заказ не существует — 404 NOT_FOUND', async () => {
    const { status, body } = await getLedger(randomUUID(), token('super_admin', null))
    expect(status).toBe(404)
    expect((body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('чужой ТЕНАНТ — 404, НЕ 403 (SRS-API-046, буквальное требование задания)', async () => {
    const orderId = await seedBalancedOrder()
    const foreignTenantStore = TenantContext.forTenant({
      tenantId: randomUUID(),
      slug: 'dtj248-foreign-tenant',
      chainId: null,
      isNeutral: false,
    })

    const result = await TenantContext.run(foreignTenantStore, async () => {
      const response = await request(httpServer)
        .get(`/api/v1/orders/${orderId}/ledger`)
        .set('Authorization', `Bearer ${token('super_admin', null)}`)
      return { status: response.status, body: response.body as ErrorBody }
    })

    expect(result.status).toBe(404)
    expect(result.body.error.code).toBe('NOT_FOUND')
  })
})
