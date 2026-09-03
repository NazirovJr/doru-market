/**
 * `IngestInventoryBatchWithMatchingUseCase` — self-deadlock пула соединений и атомарность
 * персистентной фазы (волна 6, дефект найден аудитом при исправлении ТОЧНО ТАКОГО ЖЕ дефекта
 * в checkout, DTJ-231/233; разбор — JSDoc `ingest-inventory-batch-with-matching.use-case.ts`,
 * «Границы unitOfWork.run»). Это САМОЕ серьёзное из четырёх мест аудита: колбэк был
 * `uow.run(async () => {...})` — параметр транзакции даже не был назван, ни один из ~7 вызовов
 * репозиториев не получал `tx`.
 *
 * **Уровень теста — `IngestInventoryBatchWithMatchingUseCase.execute()` напрямую**, все
 * зависимости — РЕАЛЬНЫЕ Drizzle-адаптеры (`DrizzlePharmacyInventoryRepository`,
 * `DrizzleInventorySyncBatchRepository`+`DrizzleInventorySyncErrorsRepository`,
 * `DrizzleUnitOfWorkAdapter`) против настоящего Postgres — тот же приём, что
 * `drizzle-inventory-sync-batch.repository.integration.spec.ts` (нет `AuthModule`/NestJS-бутстрапа,
 * ручное конструирование, как везде в `test/integration/inventory/**`). Все строки батча —
 * `resolved: true` (готовы к применению, `resolvedMedicineId` задан) — матчинг (ШАГ 1,
 * межмодульный `CatalogFacade`) не задействован (`fuzzyRows.length === 0` → ранний `return []`,
 * см. `matchUnresolvedRows`), поэтому `CompositeInventoryMatcherService` собран с `catalogFacade:
 * null` — не вызывается ни разу, тестирует ИМЕННО персистентную фазу (шаги 2-6), а не матчинг.
 *
 * **Тест 1 (rollback).** `fullSyncCompletion` — ИНЪЕЦИРОВАННЫЙ фейк, чей `zeroOutMissing`
 * БРОСАЕТ; `cmd.syncType='full'`/`isLastPage=true` гарантирует его вызов ПОСЛЕДНИМ шагом
 * персистентной транзакции, ПОСЛЕ РЕАЛЬНЫХ `saveMany` (остаток) и `appendErrors` (построчная
 * ошибка невалидной строки) — оба УЖЕ выполнены через РЕАЛЬНЫЕ Drizzle-адаптеры ВНУТРИ ТОЙ ЖЕ
 * `tx`. Падение здесь откатывает ВСЮ транзакцию — тест проверяет, что ни строка `pharmacy_inventory`,
 * ни строка `inventory_sync_errors` не сохранились.
 *
 * **Тест 2 (конкурентность ≥ `DEFAULT_POOL_MAX`).** 30 конкурентных `execute()` (30 >
 * `DEFAULT_POOL_MAX=10`), КАЖДЫЙ — своя `inventory_sync_batch`-строка + свой `medicineId`
 * (без пересечений — тестирует ИМЕННО пул соединений, не блокировку строки `pharmacy_inventory`,
 * это уже покрыто AC3 `checkout-race-conditions.integration.spec.ts`). Жёсткий таймаут
 * (`60_000`) — сам детектор self-deadlock: зависший пул не бросает, просто не резолвится.
 */
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  IngestInventoryBatchWithMatchingUseCase,
  type IngestRowInput,
} from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import { CompositeInventoryMatcherService } from '@/modules/inventory/application/services/composite-inventory-matcher.service.js'
import type { FullSyncCompletionPort, ZeroOutMissingInput } from '@/modules/inventory/application/ports/full-sync-completion.port.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { DrizzlePharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-inventory.repository.js'
import { DrizzleInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-sync-batch.repository.js'
import { DrizzleInventorySyncErrorsRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-sync-errors.repository.js'
import { DrizzlePharmacySkuMappingRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-pharmacy-sku-mapping.repository.js'
import { DrizzleInventoryOutboxAdapter } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-outbox.adapter.js'
import { DrizzleUnitOfWorkAdapter } from '@/modules/auth/infrastructure/adapters/drizzle-unit-of-work.adapter.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { inventorySyncErrors } from '@/db/schema/inventory-sync-errors.js'
import { inventorySyncBatch } from '@/db/schema/inventory-sync-batch.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const CONCURRENCY_TEST_TIMEOUT_MS = 60_000
const CONCURRENT_BATCH_COUNT = 30 // > DEFAULT_POOL_MAX=10 (infrastructure/database/drizzle.provider.ts)
const VALID_GLOBAL_BARCODE_PREFIX = '460123456' // + 4-значный суффикс ниже, валиден по EAN-13 не проверяется здесь (resolved=true, matcher не участвует)

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

class FixedClock implements Clock {
  now(): Date {
    return new Date()
  }
}

/** Всегда бросает — rollback-тест (см. JSDoc файла). */
class ThrowingFullSyncCompletion implements FullSyncCompletionPort {
  zeroOutMissing(_input: ZeroOutMissingInput): Promise<{ readonly zeroedLots: number }> {
    throw new Error('injected-rollback-test-failure (волна 6, доказательство атомарности)')
  }
}

class NoopFullSyncCompletion implements FullSyncCompletionPort {
  zeroOutMissing(): Promise<{ readonly zeroedLots: number }> {
    return Promise.resolve({ zeroedLots: 0 })
  }
}

describe.skipIf(!postgresAvailable)(
  'IngestInventoryBatchWithMatchingUseCase — self-deadlock пула и атомарность (волна 6)',
  () => {
    let pool: Pool
    let db: NodePgDatabase
    const createdMedicineIds: string[] = []
    let pharmacyId: string
    let categoryId: number

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      const category = await pool.query<{ id: number }>(
        `INSERT INTO categories (slug, name_tj, name_ru, name_en, commission_category, sort_order, is_active)
         VALUES ('root-w6-ingest', 'Корень', 'Root', 'Root', 'otc', 0, true)
         ON CONFLICT (slug) DO UPDATE SET slug = excluded.slug
         RETURNING id`,
      )
      categoryId = category.rows[0]?.id ?? 0
      const pharmacy = await pool.query<{ id: string }>(
        `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
         VALUES ($1, 'Test Pharmacy W6 Ingest', 'Dushanbe, test str. w6', 38.5598, 68.7870, '+992900000601')
         RETURNING id`,
        [randomUUID()],
      )
      pharmacyId = pharmacy.rows[0]?.id ?? ''
    })

    afterAll(async () => {
      await pool.query('DELETE FROM inventory_sync_errors WHERE batch_id IN (SELECT id FROM inventory_sync_batch WHERE pharmacy_id = $1)', [pharmacyId])
      await pool.query('DELETE FROM inventory_sync_raw_items WHERE batch_id IN (SELECT id FROM inventory_sync_batch WHERE pharmacy_id = $1)', [pharmacyId])
      await pool.query('DELETE FROM inventory_sync_batch WHERE pharmacy_id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacy_inventory WHERE pharmacy_id = $1', [pharmacyId])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      if (createdMedicineIds.length > 0) {
        await pool.query('DELETE FROM medicines WHERE id = ANY($1)', [createdMedicineIds])
      }
      await pool.query('DELETE FROM categories WHERE slug = $1', ['root-w6-ingest'])
      await pool.end().catch(() => undefined)
    })

    async function seedMedicine(index: number): Promise<string> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO medicines
           (id, trade_name, inn_name, category_id, dosage_form, dosage_form_class, dosage_strength,
            manufacturer_country, manufacturer_name, is_prescription_required, control_category,
            is_published, requires_cold_chain, is_globally_identifiable_by_barcode)
         VALUES ($1, $2, $3, $4, 'таблетки', 'tablet', '500 мг', 'Tajikistan', 'Test Pharma',
                 false, 'none', true, false, true)`,
        [id, `Trade-W6Ingest-${String(index)}`, `INN-W6Ingest-${String(index)}`, categoryId],
      )
      createdMedicineIds.push(id)
      return id
    }

    function buildUseCase(fullSyncCompletion: FullSyncCompletionPort): IngestInventoryBatchWithMatchingUseCase {
      const inventoryRepository = new DrizzlePharmacyInventoryRepository(db)
      const errorsRepository = new DrizzleInventorySyncErrorsRepository(db)
      const syncBatchRepository = new DrizzleInventorySyncBatchRepository(db, errorsRepository)
      const skuMappingRepository = new DrizzlePharmacySkuMappingRepository(db)
      const outbox = new DrizzleInventoryOutboxAdapter(db)
      const matcher = new CompositeInventoryMatcherService(skuMappingRepository, null, outbox)
      const uow = new DrizzleUnitOfWorkAdapter(db)
      return new IngestInventoryBatchWithMatchingUseCase(
        inventoryRepository,
        syncBatchRepository,
        matcher,
        fullSyncCompletion,
        new FixedClock(),
        uow,
      )
    }

    async function seedQueuedBatch(input: {
      readonly id: string
      readonly syncType: 'delta' | 'full'
      readonly fullSyncSessionId: string | null
      readonly isLastPage: boolean
      readonly totalRows: number
    }): Promise<void> {
      const errorsRepository = new DrizzleInventorySyncErrorsRepository(db)
      const syncBatchRepository = new DrizzleInventorySyncBatchRepository(db, errorsRepository)
      await syncBatchRepository.createIfNotExists({
        id: input.id,
        pharmacyId,
        channel: 'rest',
        syncType: input.syncType,
        fullSyncSessionId: input.fullSyncSessionId,
        isLastPage: input.isLastPage,
        totalRows: input.totalRows,
        note: null,
        now: new Date(),
      })
    }

    function makeValidResolvedRow(rowIndex: number, medicineId: string): IngestRowInput {
      return {
        rowIndex,
        internalSku: `SKU-${String(rowIndex)}`,
        rawBarcode: `${VALID_GLOBAL_BARCODE_PREFIX}${String(1000 + rowIndex)}`,
        rawTradeName: 'Аспирин',
        rawDosageForm: 'tablets',
        rawDosageStrength: '500 мг',
        rawManufacturerName: 'Acme',
        priceDiram: 15_000n,
        quantity: 10,
        expiresAtIso: '2030-12-31',
        batchNumber: `LOT-${String(rowIndex)}`,
        resolved: true,
        resolvedMedicineId: medicineId,
      }
    }

    function makeInvalidPriceRow(rowIndex: number, medicineId: string): IngestRowInput {
      return { ...makeValidResolvedRow(rowIndex, medicineId), priceDiram: -1n }
    }

    it('1. Rollback на живом Postgres — падение ПОСЛЕДНИМ шагом (full-sync zero-out) откатывает И saveMany (остаток), И appendErrors (построчная ошибка)', async () => {
      const medValid = await seedMedicine(1_000)
      const medInvalid = await seedMedicine(1_001)
      const batchId = randomUUID()
      const fullSyncSessionId = randomUUID()
      await seedQueuedBatch({ id: batchId, syncType: 'full', fullSyncSessionId, isLastPage: true, totalRows: 2 })
      const useCase = buildUseCase(new ThrowingFullSyncCompletion())

      await expect(
        useCase.execute({
          batchId,
          pharmacyId,
          syncType: 'full',
          fullSyncSessionId,
          isLastPage: true,
          rows: [makeValidResolvedRow(0, medValid), makeInvalidPriceRow(1, medInvalid)],
        }),
      ).rejects.toThrow('injected-rollback-test-failure')

      const inventoryRows = await db
        .select()
        .from(pharmacyInventory)
        .where(eq(pharmacyInventory.pharmacyId, pharmacyId))
      expect(inventoryRows).toHaveLength(0) // saveMany откачен — остаток НЕ появился

      const errorRows = await db.select().from(inventorySyncErrors).where(eq(inventorySyncErrors.batchId, batchId))
      expect(errorRows).toHaveLength(0) // appendErrors откачен — построчная ошибка НЕ осталась

      const batchRows = await db.select().from(inventorySyncBatch).where(eq(inventorySyncBatch.id, batchId))
      expect(batchRows[0]?.status).toBe('queued') // финальный save(batch) не был закоммичен
    })

    it(
      `Нагрузочный — ${String(CONCURRENT_BATCH_COUNT)} конкурентных ingest-батчей (> DEFAULT_POOL_MAX=10) → все успешны, ноль зависаний пула, по одной pharmacy_inventory-строке на каждый (defect fix — tx прокинут в PharmacyInventoryRepository/InventorySyncBatchRepository/FullSyncCompletionPort, см. use case JSDoc)`,
      async () => {
        const useCase = buildUseCase(new NoopFullSyncCompletion())
        const seeds = await Promise.all(
          Array.from({ length: CONCURRENT_BATCH_COUNT }, async (_unused, index) => {
            const medicineId = await seedMedicine(index)
            const batchId = randomUUID()
            await seedQueuedBatch({ id: batchId, syncType: 'delta', fullSyncSessionId: null, isLastPage: true, totalRows: 1 })
            return { batchId, medicineId, index }
          }),
        )

        const results = await Promise.all(
          seeds.map(({ batchId, medicineId, index }) =>
            useCase.execute({
              batchId,
              pharmacyId,
              syncType: 'delta',
              fullSyncSessionId: null,
              isLastPage: true,
              rows: [makeValidResolvedRow(index, medicineId)],
            }),
          ),
        )

        for (const result of results) {
          expect(result.status).toBe('completed_full_success')
          expect(result.acceptedRows).toBe(1)
          expect(result.rejectedRows).toBe(0)
        }

        const medicineIds = seeds.map((s) => s.medicineId)
        const inventoryRows = await db
          .select()
          .from(pharmacyInventory)
          .where(eq(pharmacyInventory.pharmacyId, pharmacyId))
        const persistedMedicineIds = new Set(inventoryRows.map((r) => r.medicineId))
        expect(inventoryRows).toHaveLength(CONCURRENT_BATCH_COUNT)
        for (const medicineId of medicineIds) {
          expect(persistedMedicineIds.has(medicineId)).toBe(true)
        }
      },
      CONCURRENCY_TEST_TIMEOUT_MS,
    )
  },
)
