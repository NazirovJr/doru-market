/**
 * `ProposeControlCategoryUseCase`/`PublishMedicineUseCase` — регресс-guard после удаления
 * декоративной `unitOfWork.run(...)` (волна 6, найдено аудитом того же дефекта, что чинили
 * в checkout DTJ-231/233 → verify-otp → telegram-auth → ingest-inventory; разбор — JSDoc обоих
 * use case'ов). ЧЕТВЁРТОЕ из четырёх мест аудита — единственное, где решение НЕ «прокинуть tx»,
 * а «убрать обёртку целиком»: `unitOfWork.run(async (_tx) => {...})` держала соединение пула БЕЗ
 * единого участника (`_tx` не использовался ни `CatalogRepository.findMedicineById`/`save`, ни
 * несуществующей пока outbox-записью) — атомарности не давала, но риск self-deadlock нёс тот же.
 *
 * **Этот файл НЕ доказывает откат** (как для остальных трёх мест) — атомарность здесь НЕ
 * заявлена и не нужна (см. JSDoc use case'ов: единственная запись, `save()`, не требует
 * атомарности сама с собой, а outbox-запись не реализована), доказывать откат нечего. Тест
 * ниже — РЕГРЕСС-GUARD: конкурентность ≥ `DEFAULT_POOL_MAX` С ЖЁСТКИМ ТАЙМАУТОМ, который поймает
 * ЛЮБУЮ будущую попытку вернуть декоративную транзакцию (тот же приём защиты, что
 * `verify-otp-race-conditions.integration.spec.ts`/`ingest-inventory-race-conditions.integration.spec.ts`
 * для мест, где транзакция осталась).
 *
 * Уровень теста — `execute()` напрямую, РЕАЛЬНЫЙ `CatalogRepositoryAdapter` против настоящего
 * Postgres, ручное конструирование (без NestJS-бутстрапа) — тот же приём, что
 * `test/integration/catalog/catalog-repository.adapter.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PublishMedicineUseCase } from '@/modules/catalog/application/use-cases/publish-medicine.use-case.js'
import { ProposeControlCategoryUseCase } from '@/modules/catalog/application/use-cases/propose-control-category.use-case.js'
import { CatalogRepositoryAdapter } from '@/modules/catalog/infrastructure/adapters/catalog-repository.adapter.js'
import { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const CONCURRENCY_TEST_TIMEOUT_MS = 60_000
const CONCURRENT_COUNT = 20 // > DEFAULT_POOL_MAX=10 (infrastructure/database/drizzle.provider.ts)
const ACTOR_ID = 'admin-w6-catalog-race'

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

describe.skipIf(!postgresAvailable)(
  'ProposeControlCategoryUseCase/PublishMedicineUseCase — регресс-guard после удаления декоративной transaction (волна 6)',
  () => {
    let pool: Pool
    let db: NodePgDatabase
    let repo: CatalogRepositoryAdapter
    let categoryId: number
    const createdMedicineIds: string[] = []

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      repo = new CatalogRepositoryAdapter(db)
      const category = await pool.query<{ id: number }>(
        `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
         VALUES ('root-w6-catalog', 'Корень', 'Root', 'Root', 'otc', 0, true)
         ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
         RETURNING id`,
      )
      categoryId = category.rows[0]?.id ?? 0
    })

    afterAll(async () => {
      if (createdMedicineIds.length > 0) {
        await pool.query('DELETE FROM medicine_substances WHERE medicine_id = ANY($1)', [createdMedicineIds])
        await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [createdMedicineIds])
      }
      await pool.query('DELETE FROM categories WHERE slug = $1', ['root-w6-catalog'])
      await pool.end().catch(() => undefined)
    })

    /** Медикамент С веществом (нужно `PublishMedicineUseCase` — `MissingSubstancesError` без него). */
    async function seedUnpublishedMedicineWithSubstance(index: number): Promise<string> {
      const id = randomUUID()
      const substanceId = randomUUID()
      await pool.query('INSERT INTO substances (id, inn_name) VALUES ($1, $2)', [substanceId, `INN-W6-${String(index)}`])
      await pool.query(
        `INSERT INTO medicines
           (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
            manufacturer_country, manufacturer_name, is_prescription_required, control_category,
            is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
         VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
                 false, 'none', false, false, true)`,
        [id, `Trade-W6Publish-${String(index)}`, `INN-Trade-W6-${String(index)}`, categoryId],
      )
      await pool.query(
        'INSERT INTO medicine_substances (medicine_id, substance_id, strength_value, strength_unit) VALUES ($1, $2, 500, $3)',
        [id, substanceId, 'mg'],
      )
      createdMedicineIds.push(id)
      return id
    }

    it(
      `Публикация — ${String(CONCURRENT_COUNT)} конкурентных PublishMedicineUseCase.execute() (> DEFAULT_POOL_MAX=10) → все успешны, ноль зависаний пула, isPublished=true у каждого`,
      async () => {
        const useCase = new PublishMedicineUseCase(repo)
        const medicineIds = await Promise.all(
          Array.from({ length: CONCURRENT_COUNT }, (_unused, index) => seedUnpublishedMedicineWithSubstance(index)),
        )

        const results = await Promise.all(
          medicineIds.map((medicineId) => useCase.execute({ medicineId, actorId: ACTOR_ID })),
        )

        expect(results).toHaveLength(CONCURRENT_COUNT)
        for (const result of results) {
          expect(result.publishedAt).toBeDefined()
        }

        for (const medicineId of medicineIds) {
          const record = await repo.findMedicineById(medicineId)
          expect(record?.isPublished).toBe(true)
        }
      },
      CONCURRENCY_TEST_TIMEOUT_MS,
    )

    it(
      `Смена категории — ${String(CONCURRENT_COUNT)} конкурентных ProposeControlCategoryUseCase.execute() (> DEFAULT_POOL_MAX=10) → все успешны, ноль зависаний пула`,
      async () => {
        const useCase = new ProposeControlCategoryUseCase(repo)
        const medicineIds = await Promise.all(
          Array.from({ length: CONCURRENT_COUNT }, (_unused, index) =>
            seedUnpublishedMedicineWithSubstance(1_000 + index),
          ),
        )

        const results = await Promise.all(
          medicineIds.map((medicineId) =>
            useCase.execute({
              medicineId,
              proposedCategory: ControlCategory.prescriptionOnly,
              actorId: ACTOR_ID,
            }),
          ),
        )

        expect(results).toHaveLength(CONCURRENT_COUNT)
        for (const result of results) {
          expect(result.proposedCategory).toBe(ControlCategory.prescriptionOnly)
          expect(result.event).toBeDefined()
        }
      },
      CONCURRENCY_TEST_TIMEOUT_MS,
    )
  },
)
