/**
 * `sql-injection.spec.ts` (DTJ-425, `TC-NFR-014`, `SRS-NFR-014`) — `GET /api/v1/medicines/search
 * ?q=<payload>` против 6 канонических OWASP SQLi-пейлоадов (`payloads/sqli.json`). Реальный HTTP
 * → реальный `CatalogSearchController` → `SearchMedicinesUseCase` → `PostgresSearchAdapter`
 * (`postgres-search.sql.ts`, Drizzle-параметризованный `sql\`...\`` template — НЕ конкатенация
 * строк), реальный Postgres. Проверяется буквально критерий приёмки №1 тикета: ни один пейлоад
 * не даёт `500`, и число строк `medicines` идентично до/после ВСЕХ 6 запросов (ни один пейлоад не
 * смог что-либо удалить/изменить через `q`).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, GUEST_TENANT_ID, type TestApp } from '@apitest/integration/orders/__tests__/test-app.js'

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

const SQLI_PAYLOADS = JSON.parse(readFileSync(join(import.meta.dirname, 'payloads/sqli.json'), 'utf8')) as readonly string[]

describe.skipIf(!postgresAvailable)('tests/security/sql-injection (DTJ-425, TC-NFR-014)', () => {
  let ctx: TestApp
  let httpServer: Server
  let pool: Pool
  const seededMedicineIds: string[] = []
  let seededCategoryId: number

  async function countMedicines(): Promise<number> {
    const result = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM medicines')
    return Number(result.rows[0]?.count ?? '0')
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    httpServer = ctx.httpServer

    // Гостевой анонимный запрос резолвится в `GUEST_TENANT_ID` (harness'а `installDefaultTenant
    // ContextHook`) — `search_query_log.tenant_id` несёт FK на `tenants(id)`, без строки insert
    // падал бы `23503` (найдено живым прогоном, тот же класс, что `cart.controller.integration.
    // spec.ts`'s собственный seed этого же тенанта).
    await pool.query('INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING', [
      GUEST_TENANT_ID,
      'dtj425-sqli-guest',
    ])

    const slug = `dtj425-sqli-${randomUUID().slice(0, 8)}`
    const categoryResult = await pool.query<{ id: number }>(
      `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
       VALUES ($1, 'Тест', 'Тест', 'Test', 'otc', 0, true) RETURNING id`,
      [slug],
    )
    const categoryRow = categoryResult.rows[0]
    if (categoryRow === undefined) throw new Error('seedCategory: INSERT ... RETURNING id returned no row')
    seededCategoryId = categoryRow.id
    const medicineId = randomUUID()
    await pool.query(
      `INSERT INTO medicines
         (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
          manufacturer_country, manufacturer_name, is_prescription_required, control_category,
          is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
       VALUES ($1, 'Paracetamol DTJ425', 'INN-Paracetamol', $2, 'таблетки', 'tablet', '500 мг',
               'Tajikistan', 'Test Pharma', false, 'none', true, false, false)`,
      [medicineId, seededCategoryId],
    )
    seededMedicineIds.push(medicineId)
  })

  afterAll(async () => {
    await ctx.close()
    await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [seededMedicineIds])
    await pool.query('DELETE FROM categories WHERE id = $1', [seededCategoryId])
    await pool.end().catch(() => undefined)
  })

  it('позитивная ветка: легитимный запрос q=Paracetamol проходит, 200', async () => {
    const response = await request(httpServer).get('/api/v1/medicines/search').query({ q: 'Paracetamol' })
    expect(response.status).toBe(200)
  })

  it.each(SQLI_PAYLOADS)('негативная ветка: SQLi-пейлоад %j → НЕ 500, medicines не изменена', async (payload) => {
    const countBefore = await countMedicines()

    const response = await request(httpServer).get('/api/v1/medicines/search').query({ q: payload })

    expect(response.status).not.toBe(500)
    expect([200, 400]).toContain(response.status)

    const countAfter = await countMedicines()
    expect(countAfter).toBe(countBefore)
  })

  it('после ВСЕХ 6 пейлоадов подряд — итоговое число строк medicines равно исходному (критерий приёмки №1, буквально)', async () => {
    const countBaseline = await countMedicines()
    for (const payload of SQLI_PAYLOADS) {
      await request(httpServer).get('/api/v1/medicines/search').query({ q: payload })
    }
    const countFinal = await countMedicines()
    expect(countFinal).toBe(countBaseline)
  })
})
