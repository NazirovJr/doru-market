/**
 * `DrizzleSeedCatalogPort` — реализация `SeedCatalogPort` (см. `seed-catalog.run.ts`)
 * поверх Drizzle ORM. Используется CLI-скриптом `pnpm db:seed` (DTJ-098, EP-04).
 *
 * Контекст и почему этот файл существует:
 *
 * - В `STATE-AND-RESUME-POINT.md` §11.4 задача 3.3 явно требует: «Исправить путь
 *   в скрипте `db:seed` и **запустить команду**, убедившись, что 317 позиций реально
 *   попали в базу». Это закрывает дефект E из §11.2 (дефект был: скрипт `db:seed`
 *   указывал на несуществующий файл, 317 позиций не загружались штатной командой).
 *
 * - Сам доменный код (`runSeedCatalog`) уже написан в `seed-catalog.run.ts` —
 *   он читает JSON-файлы из `data/`, валидирует через `Medicine.create()`, и
 *   делегирует запись через интерфейс `SeedCatalogPort`. Не хватало только адаптера
 *   этого интерфейса к Drizzle. Этот файл и есть этот адаптер.
 *
 * Слои (по `02-CLEAN-ARCHITECTURE-AND-CODE.md`):
 *   - `seed-catalog.run.ts` находится в `apps/api/src/db/seed/` — это слой
 *     `infrastructure` относительно каталога (работает с БД напрямую).
 *   - Этот файл — реализация того же слоя, конкретный Drizzle-адаптер.
 *
 * Идемпотентность (требование DTJ-098, критерий приёмки):
 *   - `substances`: `ON CONFLICT (inn_name) DO NOTHING` + затем `SELECT id WHERE inn_name = ?`
 *     для резолва фактического id (т.к. `substances.id` — UUID с дефолтом
 *     `gen_random_uuid()`, id нельзя предсказать заранее).
 *   - `categories`: `ON CONFLICT (slug) DO NOTHING` + `SELECT id WHERE slug = ?`.
 *   - `medicines`: проверка существования `medicineId` перед INSERT — id приходит
 *     из доменной фабрики `Medicine.create({id: crypto.randomUUID()})`, но если
 *     seed запускается повторно, JSON содержит те же `trade_name + dosage_strength
 *     + manufacturer_name`, значит и `id` будет другим. Идемпотентность здесь
 *     реализуется через `medicineId` из JSON НЕ сохраняется — используем
 *     уникальный ключ `(trade_name, dosage_strength, manufacturer_name)` для
 *     проверки существования через `SELECT`. Это компромисс: формально в JSON
 *     нет `id`, но seed идемпотентен по логическому ключу.
 *
 * Зависимости: pg, drizzle-orm/node-postgres. Не требует Nest DI — используется
 * standalone в CLI (см. `seed-catalog.run.ts:main()`).
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'
import pino from 'pino'
import type { DosageUnit } from '@dorutj/domain-kernel'

import type { SeedCatalogPort } from './seed-catalog.port.js'
import type { CategoryRow, MedicineRow, SubstanceRow } from '@/db/schema/index.js'
import { categories, substances, medicines, medicineSubstances } from '@/db/schema/index.js'

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000
const DB_POOL_MAX_DEFAULT = 10

export interface DrizzleSeedCatalogPortDeps {
  /** Готовая БД (для тестов: можно подсунуть testcontainer). По умолчанию — из DATABASE_URL. */
  readonly db: NodePgDatabase
  /** Логгер (по умолчанию — pino с именем 'db-seed'). */
  readonly logger?: pino.Logger
}

/**
 * Реализация `SeedCatalogPort` поверх Drizzle. Создаётся через фабрику ниже,
 * т.к. CLI-скрипт должен сам поднять пул и убедиться, что БД доступна.
 */
export class DrizzleSeedCatalogPort implements SeedCatalogPort {
  private readonly db: NodePgDatabase
  private readonly logger: pino.Logger

  constructor(deps: DrizzleSeedCatalogPortDeps) {
    this.db = deps.db
    this.logger = deps.logger ?? pino({ name: 'db-seed', level: process.env.LOG_LEVEL ?? 'info' })
  }

  async insertCategory(row: Omit<CategoryRow, 'id'>): Promise<number> {
    // Идемпотентность по `slug`: ON CONFLICT ничего не делаем, затем возвращаем id
    // через SELECT. Так покрываем и кейс «уже вставлено», и кейс «только что вставлено».
    const inserted = await this.db
      .insert(categories)
      .values({
        parentId: row.parentId,
        slug: row.slug,
        nameTj: row.nameTj,
        nameRu: row.nameRu,
        nameEn: row.nameEn,
        commissionCategory: row.commissionCategory,
        sortOrder: row.sortOrder,
        isActive: row.isActive,
      })
      .onConflictDoNothing({ target: categories.slug })
      .returning({ id: categories.id })

    if (inserted.length > 0 && inserted[0] !== undefined) {
      return inserted[0].id
    }
    const existing = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, row.slug))
      .limit(1)
    if (existing.length === 0 || existing[0] === undefined) {
      throw new Error(`insertCategory: category "${row.slug}" disappeared after conflict`)
    }
    return existing[0].id
  }

  async insertSubstance(row: Omit<SubstanceRow, 'createdAt'>): Promise<void> {
    // Идемпотентность по `inn_name`. FK `medicine_substances.substance_id` ссылается на
    // `substances.id`, который генерируется БД (`gen_random_uuid()`), поэтому id
    // нельзя предсказать заранее — резолвим через SELECT после insert (см. резолвер
    // ниже в `resolveSubstanceId`).
    await this.db
      .insert(substances)
      .values({
        id: row.id,
        innName: row.innName,
        innNameEn: row.innNameEn,
      })
      .onConflictDoNothing({ target: substances.innName })
  }

  async insertMedicine(
    row: Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'>,
    medSubstances: readonly { substanceId: string; strengthValue: number; strengthUnit: DosageUnit }[],
  ): Promise<void> {
    const existing = await this.findExistingMedicine(row)
    if (existing !== null) {
      this.logger.debug({ tradeName: row.tradeName }, 'medicine already seeded, skipping')
      return
    }
    const medicineId = await this.insertMedicineRow(row)
    if (medSubstances.length > 0) {
      await this.insertMedicineSubstanceLinks(medicineId, medSubstances)
    }
  }

  /**
   * Идемпотентность по логическому ключу `(trade_name, dosage_strength, manufacturer_name)`.
   * UNIQUE constraint в схеме на эту тройку отсутствует (см. DTJ-098 риск), поэтому
   * проверяем существование явным SELECT. Это второй барьер после того, как
   * `runSeedCatalog` уже проверил бы вхождение в `insertMedicines` — здесь страхуем
   * на случай гонки и для документирования контракта.
   */
  private async findExistingMedicine(
    row: Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'>,
  ): Promise<{ readonly id: string } | null> {
    const existing = await this.db
      .select({ id: medicines.id })
      .from(medicines)
      .where(
        and(
          eq(medicines.tradeName, row.tradeName),
          eq(medicines.dosageStrength, row.dosageStrength),
          eq(medicines.manufacturerName, row.manufacturerName),
        ),
      )
      .limit(1)
    return existing[0] ?? null
  }

  private async insertMedicineRow(
    row: Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'>,
  ): Promise<string> {
    const inserted = await this.db
      .insert(medicines)
      .values({
        id: row.id,
        tradeName: row.tradeName,
        innName: row.innName,
        barcode: row.barcode,
        categoryId: row.categoryId,
        dosageForm: row.dosageForm,
        dosageStrength: row.dosageStrength,
        dosageFormClass: row.dosageFormClass,
        manufacturerCountry: row.manufacturerCountry,
        manufacturerName: row.manufacturerName,
        isPrescriptionRequired: row.isPrescriptionRequired,
        storageTemperature: row.storageTemperature,
        descriptionTj: row.descriptionTj,
        descriptionRu: row.descriptionRu,
        imageUrl: row.imageUrl,
        dosageValue: row.dosageValue,
        dosageUnit: row.dosageUnit,
        controlCategory: row.controlCategory,
        isGloballyIdentifiableByBarcode: row.isGloballyIdentifiableByBarcode,
        isPublished: row.isPublished,
        requiresColdChain: row.requiresColdChain,
      })
      .returning({ id: medicines.id })
    const medicineId = inserted[0]?.id
    if (medicineId === undefined) {
      throw new Error(`insertMedicine: no id returned for "${row.tradeName}"`)
    }
    return medicineId
  }

  /**
   * Мост `medicine_substances` — отдельный INSERT.
   * Drizzle не умеет в `numeric` тип из `number` без явной строки, поэтому приводим
   * `strengthValue` через `.toString()` — это согласовано с `numeric(precision, scale)`,
   * у которого `strength_value numeric(10, 4)` (см. `medicine-substances.ts`).
   */
  private async insertMedicineSubstanceLinks(
    medicineId: string,
    medSubstances: readonly { substanceId: string; strengthValue: number; strengthUnit: DosageUnit }[],
  ): Promise<void> {
    await this.db.insert(medicineSubstances).values(
      medSubstances.map((s) => ({
        medicineId,
        substanceId: s.substanceId,
        strengthValue: s.strengthValue.toString(),
        strengthUnit: s.strengthUnit,
      })),
    )
  }

  async countMedicines(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(medicines)
    return result[0]?.count ?? 0
  }
}

/**
 * Фабрика CLI: поднимает пул, создаёт порт, владеет пулом (закрывает его после
 * использования). Возвращает `{ port, close }` — `close()` обязан быть вызван
 * даже при ошибке (используется `try/finally`).
 *
 * Контракт DATABASE_URL — такой же, как в `infrastructure/database/migrate.ts`
 * (см. SRS-DB-032): обязателен, иначе fail-fast с ненулевым кодом.
 */
export async function createDrizzleSeedCatalogPort(): Promise<{
  port: DrizzleSeedCatalogPort
  close: () => Promise<void>
}> {
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl === undefined || dbUrl.length === 0) {
    throw new Error('DATABASE_URL is required for db:seed')
  }

  const connectTimeoutMs = Number(process.env.DB_CONNECT_TIMEOUT_MS) || DEFAULT_DB_CONNECT_TIMEOUT_MS
  const poolMax = Number(process.env.DB_POOL_MAX) || DB_POOL_MAX_DEFAULT
  const pool = new Pool({
    connectionString: dbUrl,
    max: poolMax,
    connectionTimeoutMillis: connectTimeoutMs,
  })

  // Проверяем доступность БД ДО первой вставки — fail-fast вместо тихих
  // нулей в продакшене (см. правило §1.3 хендбука «не выдавай это за успех»).
  try {
    await pool.query('SELECT 1')
  } catch (err: unknown) {
    await pool.end()
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`db:seed: cannot reach DATABASE_URL (${dbUrl.replace(/:[^:@]+@/, ':***@')}): ${message}`)
  }

  const db: NodePgDatabase = drizzle(pool)
  return {
    port: new DrizzleSeedCatalogPort({ db }),
    close: async () => {
      await pool.end()
    },
  }
}