/**
 * `tenant-isolation-idor.spec.ts` (DTJ-425, `TC-NFR-005`/`TC-NFR-006`, `SRS-NFR-005`/`SRS-NFR-006`)
 * — межтенантный IDOR (заказ тенанта A виден фармацевту тенанта B) + инъекция через палитру
 * брендинга White-Label (`PATCH /tenant-settings/:tenantId`). Реальный HTTP → реальный Postgres,
 * никаких моков use case/репозитория.
 *
 * **Часть 1 (`TC-NFR-005`) — расхождение с буквальной формулировкой тикета, зафиксировано, НЕ
 * ослаблено.** Тикет ожидает `403 CROSS_TENANT_ACCESS_DENIED` на уровне guard'а И спай на
 * репозиторий тенанта B с НУЛЕМ вызовов. Реальный `GetHandoverOtpUseCase`
 * (`apps/api/src/modules/orders/application/pharmacy-terminal/get-handover-otp.use-case.ts`)
 * реализует изоляцию ИНАЧЕ: `OrderRepositoryPort.findById(actor.tenantId, orderId)` — тенант
 * ВСЕГДА часть WHERE самого запроса (репозиторий ВЫЗЫВАЕТСЯ, не пропускается), заказ другого
 * тенанта физически не может попасть в результат → `404 NotFoundError`, не `403`. Проверено
 * чтением исходника (`loadAuthorizedOrder`), не предположение. Это ВСЁ ЕЩЁ полноценная защита от
 * IDOR (данные чужого тенанта НИКОГДА не покидают репозиторий/БД, факт существования заказа не
 * раскрывается — `404`, а не «этот заказ существует, но 403»), просто другой, тоже валидный
 * паттерн (tenant-scoped query), чем ожидал буквальный текст тикета (guard ДО репозитория). Тест
 * ниже проверяет РЕАЛЬНЫЙ инвариант — нулевую утечку данных — а не конкретный код ответа/спай на
 * количество вызовов, который потребовал бы переписывать боевой `GetHandoverOtpUseCase` под этот
 * тикет (вне `files_owned` DTJ-425, чужой код). Расхождение с буквальным текстом тикета
 * задокументировано в отчёте сдачи (`НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ`), не тихо подогнано под факт.
 *
 * **Часть 2 (`TC-NFR-006`) — реальный маршрут.** Тикет пишет `PUT /admin/tenants/:id/branding`
 * (такого маршрута нет нигде в кодовой базе) — реальный маршрут `PATCH
 * /api/v1/tenant-settings/:tenantId` (`TenantsController`), `brandPalette` валидируется
 * `BrandPaletteSchema` (`packages/contracts/src/admin/tenants.ts`, `z.record(..., z.string().
 * regex(/^#[0-9a-fA-F]{6}$/u))`) ДО того, как патч доходит до facade/БД. Пейлоады — ЕДИНЫЙ список
 * с `packages/ui/src/tokens/branding-allowlist.spec.ts` (DTJ-401), читаются из
 * `payloads/branding-injection.json` ОБОИМИ файлами (DoD: не дублируются независимым списком).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp as createOrdersTestApp, type TestApp as OrdersTestApp } from '@apitest/integration/orders/__tests__/test-app.js'
import { createTestApp as createTenantsTestApp, type TestApp as TenantsTestApp } from '@apitest/integration/admin/__tests__/tenants-test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_500 })
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
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface SuccessBody<T> {
  readonly data: T
}
interface TenantDetailBody {
  readonly brandPalette: Readonly<Record<string, string>>
}

const BRANDING_INJECTION_PAYLOADS = JSON.parse(
  readFileSync(join(import.meta.dirname, 'payloads/branding-injection.json'), 'utf8'),
) as readonly string[]
/** Подмножество, которое НИ ПРИ КАКИХ обстоятельствах не должно пройти 6-значный HEX-regex сервера. */
const CLEARLY_MALICIOUS_PAYLOADS = BRANDING_INJECTION_PAYLOADS.filter(
  (payload) => payload.includes('script') || payload.includes('javascript') || payload.includes('url(') || payload.includes('expression('),
)

describe.skipIf(!postgresAvailable)('tests/security/tenant-isolation-idor (DTJ-425, TC-NFR-005/006)', () => {
  describe('TC-NFR-005 — межтенантный IDOR: GET /orders/:id/handover-otp', () => {
    let ctx: OrdersTestApp
    let httpServer: Server
    let pool: Pool
    let jwtSigner: JwtSignerPort
    const TENANT_A = randomUUID()
    const TENANT_B = randomUUID()
    let pharmacyIdA: string
    let orderIdA: string
    let orderNumberCounter = 1
    const cleanupIds: { users: string[]; orders: string[]; pharmacies: string[]; tenants: string[]; otp: string[] } = {
      users: [],
      orders: [],
      pharmacies: [],
      tenants: [TENANT_A, TENANT_B],
      otp: [],
    }

    function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
      return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
    }

    async function seedTenant(id: string, slug: string): Promise<void> {
      await pool.query(
        `INSERT INTO tenants (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status) VALUES ($1, $2, false, 'platform_pool', 'none')`,
        [id, slug],
      )
    }

    async function seedPharmacy(): Promise<string> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone, is_active)
         VALUES ($1, 'DTJ-425 Test Pharmacy', 'Dushanbe, test street 1', 38.5598, 68.7870, '+992900000001', true)`,
        [id],
      )
      cleanupIds.pharmacies.push(id)
      return id
    }

    async function seedPharmacistUser(tenantId: string, pharmacyId: string): Promise<{ id: string }> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO users (id, tenant_id, phone_number, role, pharmacy_id, is_active) VALUES ($1, $2, $3, 'pharmacist', $4, true)`,
        [id, tenantId, `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`, pharmacyId],
      )
      cleanupIds.users.push(id)
      return { id }
    }

    /** Заказ ТЕНАНТА A, статус `picked_up`, с реальным (не фейковым) `handover_otp_id`. */
    async function seedPickedUpOrderWithHandoverOtp(tenantId: string, pharmacyId: string): Promise<string> {
      const customerId = randomUUID()
      await pool.query(
        `INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`,
        [customerId, tenantId, `+99291${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`],
      )
      cleanupIds.users.push(customerId)

      const otpId = randomUUID()
      await pool.query(
        `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, expires_at, plain_code)
         VALUES ($1, $2, $3, 'delivery_handover', 'x', now() + interval '1 hour', '135790')`,
        [otpId, tenantId, `order-handover:${otpId}`],
      )
      cleanupIds.otp.push(otpId)

      // `OrderNumber` VO (`shared-kernel/domain/value-objects/order-number.vo.ts`) — формат
      // СТРОГО `DTJ-YYMMDD-NNNNN` (`/^DTJ-\d{6}-\d{5}$/`), не произвольная строка.
      const orderId = randomUUID()
      const orderNumber = `DTJ-260925-${String(orderNumberCounter).padStart(5, '0')}`
      orderNumberCounter += 1
      await pool.query(
        `INSERT INTO orders (
           id, order_number, customer_id, pharmacy_id, status, payment_method,
           items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
           tenant_id, checkout_attempt_id, handover_otp_id
         ) VALUES ($1, $2, $3, $4, 'picked_up', 'cash', 10000, 0, 10000, 'Test address 1', $5, $6, $7)`,
        [orderId, orderNumber, customerId, pharmacyId, tenantId, randomUUID(), otpId],
      )
      cleanupIds.orders.push(orderId)
      return orderId
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      await seedTenant(TENANT_A, `dtj425-idor-a-${TENANT_A.slice(0, 8)}`)
      await seedTenant(TENANT_B, `dtj425-idor-b-${TENANT_B.slice(0, 8)}`)
      pharmacyIdA = await seedPharmacy()
      orderIdA = await seedPickedUpOrderWithHandoverOtp(TENANT_A, pharmacyIdA)

      ctx = await createOrdersTestApp()
      httpServer = ctx.httpServer
      jwtSigner = ctx.app.get<JwtSignerPort>(JWT_SIGNER)
    })

    afterAll(async () => {
      await ctx.close()
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [cleanupIds.orders])
      await pool.query('DELETE FROM otp_codes WHERE id = ANY($1)', [cleanupIds.otp])
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [cleanupIds.users])
      await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [cleanupIds.pharmacies])
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [cleanupIds.tenants])
      await pool.end().catch(() => undefined)
    })

    it('позитивная ветка: фармацевт ТЕНАНТА A видит handover-otp СВОЕГО заказа', async () => {
      const pharmacistA = await seedPharmacistUser(TENANT_A, pharmacyIdA)
      const tokenA = sign({ sub: pharmacistA.id, role: 'pharmacist', tenantId: TENANT_A, pharmacyId: pharmacyIdA, chainId: null })

      const response = await request(httpServer)
        .get(`/api/v1/orders/${orderIdA}/handover-otp`)
        .set('Authorization', `Bearer ${tokenA}`)

      expect(response.status).toBe(200)
      const body = response.body as SuccessBody<{ code: string }>
      expect(body.data.code).toBe('135790')
    })

    it('негативная ветка (IDOR): фармацевт ТЕНАНТА B с JWT tenantId=B запрашивает заказ ТЕНАНТА A → НЕ 200, данные заказа A не раскрыты', async () => {
      const pharmacyIdB = await seedPharmacy()
      const pharmacistB = await seedPharmacistUser(TENANT_B, pharmacyIdB)
      const tokenB = sign({ sub: pharmacistB.id, role: 'pharmacist', tenantId: TENANT_B, pharmacyId: pharmacyIdB, chainId: null })

      const response = await request(httpServer)
        .get(`/api/v1/orders/${orderIdA}/handover-otp`)
        .set('Authorization', `Bearer ${tokenB}`)

      // Реальное поведение — 404 (tenant-scoped запрос не находит строку), НЕ 200. Ключевой
      // инвариант: код OTP заказа A НИКОГДА не попадает в ответ тенанту B.
      expect(response.status).not.toBe(200)
      expect([403, 404]).toContain(response.status)
      const body = response.body as ErrorBody
      expect(JSON.stringify(body)).not.toContain('135790')
    })
  })

  describe('TC-NFR-006 — CSS/HTML-инъекция через brandPalette: PATCH /tenant-settings/:tenantId', () => {
    let ctx: TenantsTestApp
    let httpServer: Server
    let pool: Pool
    let jwtSigner: JwtSignerPort
    let superAdminToken: string
    let managedTenantId: string
    const OPERATOR_TENANT_ID = randomUUID()
    const createdUserIds: string[] = []
    const createdTenantIds: string[] = [OPERATOR_TENANT_ID]

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
        OPERATOR_TENANT_ID,
        `dtj425-branding-op-${OPERATOR_TENANT_ID.slice(0, 8)}`,
      ])
      await pool.query(
        `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'Operator', '{}'::jsonb, 'tj')`,
        [OPERATOR_TENANT_ID],
      )
      managedTenantId = randomUUID()
      await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
        managedTenantId,
        `dtj425-branding-managed-${managedTenantId.slice(0, 8)}`,
      ])
      await pool.query(
        `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'Managed Brand', '{}'::jsonb, 'tj')`,
        [managedTenantId],
      )
      createdTenantIds.push(managedTenantId)

      ctx = await createTenantsTestApp()
      httpServer = ctx.httpServer
      jwtSigner = ctx.app.get<JwtSignerPort>(JWT_SIGNER)
      const superAdminId = randomUUID()
      await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'super_admin', true)`, [
        superAdminId,
        OPERATOR_TENANT_ID,
        `+99292${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      ])
      createdUserIds.push(superAdminId)
      superAdminToken = jwtSigner.sign({
        sub: superAdminId,
        role: 'super_admin',
        tenantId: OPERATOR_TENANT_ID,
        pharmacyId: null,
        chainId: null,
        sessionId: randomUUID(),
      })
    })

    afterAll(async () => {
      await ctx.close()
      await pool.query('DELETE FROM tenant_settings WHERE tenant_id = ANY($1)', [createdTenantIds])
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdTenantIds])
      await pool.end().catch(() => undefined)
    })

    it('позитивная ветка: валидный 6-значный HEX проходит и сохраняется', async () => {
      const response = await request(httpServer)
        .patch(`/api/v1/tenant-settings/${managedTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ brandPalette: { '--brand-primary': '#123abc' } })

      expect(response.status).toBe(200)
      const body = response.body as SuccessBody<TenantDetailBody>
      expect(body.data.brandPalette['--brand-primary']).toBe('#123abc')
    })

    it.each(BRANDING_INJECTION_PAYLOADS)(
      'негативная ветка (TC-NFR-006): payload %j в brandPalette["--brand-primary"] → 400, БД не изменена',
      async (payload) => {
        const before = await pool.query<{ brand_palette: Record<string, string> }>(
          'SELECT brand_palette FROM tenant_settings WHERE tenant_id = $1',
          [managedTenantId],
        )

        const response = await request(httpServer)
          .patch(`/api/v1/tenant-settings/${managedTenantId}`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ brandPalette: { '--brand-primary': payload } })

        expect(response.status).toBe(400)
        const body = response.body as ErrorBody
        expect(body.error.code).toBe('VALIDATION_ERROR')

        const after = await pool.query<{ brand_palette: Record<string, string> }>(
          'SELECT brand_palette FROM tenant_settings WHERE tenant_id = $1',
          [managedTenantId],
        )
        expect(after.rows[0]?.brand_palette).toEqual(before.rows[0]?.brand_palette)
      },
    )

    it(`клинически вредоносные пейлоады (${String(CLEARLY_MALICIOUS_PAYLOADS.length)} шт.: script/javascript:/url()/expression()) — ни один не долетает до JSON-ответа`, async () => {
      for (const payload of CLEARLY_MALICIOUS_PAYLOADS) {
        const response = await request(httpServer)
          .patch(`/api/v1/tenant-settings/${managedTenantId}`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ brandPalette: { '--brand-primary': payload } })
        expect(response.status).toBe(400)
        expect(JSON.stringify(response.body)).not.toContain('<script>')
      }
    })
  })
})
