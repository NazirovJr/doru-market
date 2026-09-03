/**
 * `CartController` — Supertest интеграция (EP-09, DTJ-226) против РЕАЛЬНЫХ Postgres/Redis
 * (D-EP09-14: живые сервисы + `describe.skipIf`, не Testcontainers — пакета в проекте нет).
 * Один кейс на каждый эндпоинт тикета + коды ошибок (тест-план DTJ-226):
 *
 *   - `GET /api/v1/cart` (гость, затем повторно с выданным `X-Cart-Session-Token`)
 *   - `POST /api/v1/cart/items` (гость и аутентифицированный `customer`)
 *   - `PATCH /api/v1/cart/items/:id`
 *   - `DELETE /api/v1/cart/items/:id`
 *   - AC3: `POST .../items` с `control_category='psychotropic'` → `422
 *     CONTROLLED_SUBSTANCE_FORBIDDEN` (реальный код каталога, см. JSDoc `cart.controller.ts`)
 *   - Подбор чужой гостевой корзины: НОВЫЙ гость (без токена) НЕ видит позиции ПЕРВОГО гостя
 *   - Session fixation (правка приёмки CTO): угадываемый `X-Cart-Session-Token`, под которым
 *     корзины нет, НЕ становится ключом новой строки `cart` — сервер выдаёт свой токен
 *
 * `NestApplication`/сиды `pharmacies`/`medicines`/`pharmacy_inventory` поднимаются ОДИН раз в
 * `beforeAll` (дорого пересобирать `OrdersModule`, тянущий `Catalog`/`Onboarding`/`AuthModule`,
 * на каждый тест) — `afterEach` чистит только `cart`/`cart_items` своего тенанта между тестами.
 * Уборка (правило 5 AGENTS.md): `afterAll` удаляет строки этого файла по id, не `TRUNCATE`.
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, GUEST_TENANT_ID, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

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
  readonly error: { readonly code: string; readonly message?: string }
}

describe.skipIf(!postgresAvailable)('CartController — Supertest integration (DTJ-226)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let pharmacyId: string
  let medicineId: string
  let psychotropicMedicineId: string
  const createdUserIds: string[] = []

  async function resolveRootCategoryId(): Promise<number> {
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

  async function seedMedicine(controlCategory: string): Promise<string> {
    const id = randomUUID()
    const categoryId = await resolveRootCategoryId()
    // chk_medicines_control_category_requires_rx: potent/psychotropic/narcotic ⇒ Rx обязателен.
    const requiresRx = controlCategory !== 'none'
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
               $6, $5, true, false, true)`,
      [id, `Trade-DTJ226C-${id}`, `INN-DTJ226C-${id}`, categoryId, controlCategory, requiresRx],
    )
    return id
  }

  async function seedInventory(forPharmacyId: string, forMedicineId: string): Promise<void> {
    await pool.query(
      `INSERT INTO pharmacy_inventory (pharmacy_id, medicine_id, price, quantity, expires_at)
       VALUES ($1, $2, 15000, 100, CURRENT_DATE + INTERVAL '1 year')`,
      [forPharmacyId, forMedicineId],
    )
  }

  async function seedCustomer(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO users (id, tenant_id, phone_number, role, is_active)
       VALUES ($1, $2, $3, 'customer', true)`,
      [id, GUEST_TENANT_ID, `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`],
    )
    createdUserIds.push(id)
    return id
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      GUEST_TENANT_ID,
      'test-orders-guest',
    ])
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-226-C', 'Dushanbe, test str. 3', 38.5598, 68.7870, '+992900000002')`,
      [id],
    )
    pharmacyId = id
    medicineId = await seedMedicine('none')
    psychotropicMedicineId = await seedMedicine('psychotropic')
    await seedInventory(pharmacyId, medicineId)
    await seedInventory(pharmacyId, psychotropicMedicineId)

    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
  })

  afterAll(async () => {
    // try/finally: `ctx.close()` бросающий (или падение beforeAll до `ctx = await
    // createTestApp()`) НЕ должен оставлять сиротами seed-строки этого файла — правило 5
    // AGENTS.md «тест обязан убирать за собой» держится ДАЖЕ когда сам прогон нестабилен
    // (наблюдалось на практике: транзитный сбой резолвинга DI параллельного тикета в
    // OrdersModule оставил 7 строк medicines/4 pharmacies до этой правки).
    try {
      await ctx.close()
    } finally {
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [[medicineId, psychotropicMedicineId]])
      await pool.query('DELETE FROM tenants WHERE id = $1', [GUEST_TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  afterEach(async () => {
    await pool.query('DELETE FROM cart WHERE tenant_id = $1', [GUEST_TENANT_ID])
  })

  it('GET /api/v1/cart — гость без токена получает пустую корзину + НОВЫЙ X-Cart-Session-Token', async () => {
    const res = await request(httpServer).get('/api/v1/cart')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<{ items: unknown[] }>
    expect(body.data.items).toEqual([])
    expect(res.headers['x-cart-session-token']).toBeDefined()
  })

  it('GET /api/v1/cart — предъявление ТОГО ЖЕ токена резолвит ТУ ЖЕ корзину (не создаёт новую)', async () => {
    const first = await request(httpServer).get('/api/v1/cart')
    const token = first.headers['x-cart-session-token']!

    await request(httpServer)
      .post('/api/v1/cart/items')
      .set('X-Cart-Session-Token', token)
      .send({ medicineId, pharmacyId, quantity: 2 })
      .expect(201)

    const second = await request(httpServer).get('/api/v1/cart').set('X-Cart-Session-Token', token)
    expect(second.status).toBe(200)
    const body = second.body as SuccessBody<{ items: { medicineId: string; medicineTradeName: string }[] }>
    expect(body.data.items).toHaveLength(1)
    // DTJ-234 (дефект приёмки, живой прогон): ответ несёт читаемое название препарата
    // (`medicines.trade_name`, посеяно как `Trade-DTJ226C-<id>` в `seedMedicine` выше), не UUID.
    expect(body.data.items[0]?.medicineTradeName).toBe(`Trade-DTJ226C-${medicineId}`)
    expect(body.data.items[0]?.medicineTradeName).not.toBe(medicineId)
    // Токен уже известен клиенту — повторно НЕ переиздаётся.
    expect(second.headers['x-cart-session-token']).toBeUndefined()
  })

  it('Подбор чужой гостевой корзины: НОВЫЙ гость без токена НЕ видит позиции первого гостя', async () => {
    const first = await request(httpServer)
      .post('/api/v1/cart/items')
      .send({ medicineId, pharmacyId, quantity: 1 })
      .expect(201)
    expect(first.headers['x-cart-session-token']).toBeDefined()

    const strangerView = await request(httpServer).get('/api/v1/cart')
    const body = strangerView.body as SuccessBody<{ items: unknown[] }>
    expect(body.data.items).toEqual([])
    expect(strangerView.headers['x-cart-session-token']).not.toBe(first.headers['x-cart-session-token'])
  })

  it('session fixation (правка приёмки CTO): X-Cart-Session-Token с угадываемым значением, под которым корзины нет — сервер выдаёт НОВЫЙ токен, повторный запрос со старым значением снова не видит созданную корзину', async () => {
    const guessableToken = 'guessable-token'

    const res = await request(httpServer).get('/api/v1/cart').set('X-Cart-Session-Token', guessableToken)

    expect(res.status).toBe(200)
    const issued = res.headers['x-cart-session-token']
    expect(issued).toBeDefined()
    expect(issued).not.toBe(guessableToken)

    const repeat = await request(httpServer).get('/api/v1/cart').set('X-Cart-Session-Token', guessableToken)
    // Тот же угадываемый заголовок снова резолвится в НОВУЮ пустую гостевую сессию — не в
    // корзину, созданную выше под сервер-сгенерированным токеном.
    expect(repeat.headers['x-cart-session-token']).toBeDefined()
    expect(repeat.headers['x-cart-session-token']).not.toBe(guessableToken)
    expect(repeat.headers['x-cart-session-token']).not.toBe(issued)
  })

  it('POST /api/v1/cart/items — 201, тело — созданная строка', async () => {
    const res = await request(httpServer).post('/api/v1/cart/items').send({ medicineId, pharmacyId, quantity: 3 })

    expect(res.status).toBe(201)
    const body = res.body as SuccessBody<{ id: string; medicineId: string; quantity: number }>
    expect(body.data.medicineId).toBe(medicineId)
    expect(body.data.quantity).toBe(3)
  })

  it('DTJ-234 (дефект приёмки, живой прогон): duplicate_substance несёт РЕАЛЬНЫЕ названия препаратов и вещества, не UUID', async () => {
    // Второй медикамент + общее с `medicineId` действующее вещество — seed'ится ЗДЕСЬ (не в
    // общем beforeAll), убирается в finally этого теста (правило 5 AGENTS.md — не TRUNCATE).
    const secondMedicineId = await seedMedicine('none')
    await seedInventory(pharmacyId, secondMedicineId)
    const substanceId = randomUUID()
    await pool.query(
      `INSERT INTO substances (id, inn_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [substanceId, `Ibuprofen-DTJ234-${substanceId}`],
    )
    await pool.query(
      `INSERT INTO medicine_substances (medicine_id, substance_id, strength_value, strength_unit)
       VALUES ($1, $3, 200, 'mg'), ($2, $3, 200, 'mg')`,
      [medicineId, secondMedicineId, substanceId],
    )

    try {
      const first = await request(httpServer)
        .post('/api/v1/cart/items')
        .send({ medicineId, pharmacyId, quantity: 1 })
        .expect(201)
      const token = first.headers['x-cart-session-token']!

      const second = await request(httpServer)
        .post('/api/v1/cart/items')
        .set('X-Cart-Session-Token', token)
        .send({ medicineId: secondMedicineId, pharmacyId, quantity: 1 })

      expect(second.status).toBe(201)
      const body = second.body as SuccessBody<unknown>
      const warnings = body.meta?.warnings as
        | readonly {
            readonly existingMedicineId: string
            readonly existingMedicineTradeName: string | null
            readonly newMedicineId: string
            readonly newMedicineTradeName: string
            readonly substanceNames: readonly string[]
          }[]
        | undefined
      expect(warnings).toHaveLength(1)
      const warning = warnings?.[0]
      expect(warning?.existingMedicineId).toBe(medicineId)
      expect(warning?.existingMedicineTradeName).toBe(`Trade-DTJ226C-${medicineId}`)
      expect(warning?.newMedicineId).toBe(secondMedicineId)
      expect(warning?.newMedicineTradeName).toBe(`Trade-DTJ226C-${secondMedicineId}`)
      // Правка (задача 1, дефект «название вещества не доходит никуда»):
      // `CatalogRepositoryAdapter.findSubstancesByMedicineIds` теперь джойнится на `substances`
      // за `innName` (было — хардкод `''`). Сверяем РЕАЛЬНЫЙ текст, не только длину массива —
      // иначе регресс (снова пустая строка) снова прошёл бы этот тест незамеченным.
      expect(warning?.substanceNames).toEqual([`Ibuprofen-DTJ234-${substanceId}`])
      // Ни одно название препарата не совпадает с UUID — живое доказательство фикса дефекта приёмки.
      expect(warning?.existingMedicineTradeName).not.toBe(medicineId)
      expect(warning?.newMedicineTradeName).not.toBe(secondMedicineId)
    } finally {
      await pool.query('DELETE FROM medicine_substances WHERE substance_id = $1', [substanceId])
      await pool.query('DELETE FROM substances WHERE id = $1', [substanceId])
      await pool.query('DELETE FROM pharmacy_inventory WHERE medicine_id = $1', [secondMedicineId])
      await pool.query('DELETE FROM medicines WHERE id = $1', [secondMedicineId])
    }
  })

  it('AC3: POST .../items с psychotropic медикаментом → 422 CONTROLLED_SUBSTANCE_FORBIDDEN', async () => {
    const res = await request(httpServer)
      .post('/api/v1/cart/items')
      .send({ medicineId: psychotropicMedicineId, pharmacyId, quantity: 1 })

    expect(res.status).toBe(422)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('CONTROLLED_SUBSTANCE_FORBIDDEN')
  })

  it('PATCH /api/v1/cart/items/:id — 200, обновляет quantity в рамках той же гостевой сессии', async () => {
    const created = await request(httpServer)
      .post('/api/v1/cart/items')
      .send({ medicineId, pharmacyId, quantity: 1 })
      .expect(201)
    const token = created.headers['x-cart-session-token']!
    const itemId = (created.body as SuccessBody<{ id: string }>).data.id

    const res = await request(httpServer)
      .patch(`/api/v1/cart/items/${itemId}`)
      .set('X-Cart-Session-Token', token)
      .send({ quantity: 7 })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<{ quantity: number }>
    expect(body.data.quantity).toBe(7)
  })

  it('DELETE /api/v1/cart/items/:id — 204', async () => {
    const created = await request(httpServer)
      .post('/api/v1/cart/items')
      .send({ medicineId, pharmacyId, quantity: 1 })
      .expect(201)
    const token = created.headers['x-cart-session-token']!
    const itemId = (created.body as SuccessBody<{ id: string }>).data.id

    const res = await request(httpServer).delete(`/api/v1/cart/items/${itemId}`).set('X-Cart-Session-Token', token)

    expect(res.status).toBe(204)
  })

  it('аутентифицированный customer: POST .../items привязывает позицию к customerId, не к session_token', async () => {
    const userId = await seedCustomer()
    const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    const accessToken = jwtSigner.sign({
      sub: userId,
      role: 'customer',
      tenantId: GUEST_TENANT_ID,
      pharmacyId: null,
      chainId: null,
      sessionId: randomUUID(),
    })

    const res = await request(httpServer)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ medicineId, pharmacyId, quantity: 1 })

    expect(res.status).toBe(201)
    expect(res.headers['x-cart-session-token']).toBeUndefined()
  })

  it('без Authorization и без X-Cart-Session-Token — гость (не 401): корзина публична', async () => {
    const res = await request(httpServer).get('/api/v1/cart')
    expect(res.status).toBe(200)
  })
})
