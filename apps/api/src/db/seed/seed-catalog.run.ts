/**
 * Запуск seed каталога (DTJ-098, EP-04). Создаёт ≥300 курированных позиций medicines +
 * ~80 substances + ~15 категорий в одной команде `pnpm db:seed` (D-13).
 *
 * Логика:
 * 1. Читает `medicines.seed.json` + `substances.seed.json` + `categories.seed.json`
 *    (источник — `apps/api/src/db/seed/data/`).
 * 2. Использует доменные фабрики `Medicine.create()` / `Medicine.publish()` (НЕ
 *    прямой INSERT в обход инвариантов — seed обязан пройти через тот же домен,
 *    что и продакшен-путь, иначе seed может создать невалидное состояние).
 * 3. Идемпотентность: проверка существования `medicine_id` перед вставкой
 *    (нет UNIQUE constraint на `(trade_name, dosage_strength, manufacturer_name)`
 *    в схеме, как требует DTJ-098).
 *
 * Запускается из CLI: `pnpm db:seed`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DosageForm, isOk, type DosageFormClass, type DosageUnit } from '@dorutj/domain-kernel'
import type { ControlCategory } from '@/modules/catalog/domain/medicine.enums.js'
import { Medicine } from '@/modules/catalog/domain/medicine.entity.js'
import type { MedicineRow } from '@/db/schema/index.js'
import type { SeedCatalogPort } from './seed-catalog.port.js'

const FILE_URL_PATH = fileURLToPath(import.meta.url)
const MODULE_DIR = dirname(FILE_URL_PATH)
const DATA_DIR = resolve(MODULE_DIR, 'data')

interface SeedCategory {
  readonly slug: string
  readonly nameTj: string
  readonly nameRu: string
  readonly nameEn: string
  readonly commissionCategory: 'rx' | 'otc' | 'parapharma'
  readonly parentSlug: string | null
  readonly sortOrder: number
}

interface SeedSubstance {
  readonly id: string
  readonly innName: string
  readonly innNameEn?: string
}

interface SeedMedicine {
  readonly tradeName: string
  readonly innName: string
  readonly barcode?: string
  readonly categorySlug: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly dosageFormClass: DosageFormClass
  readonly manufacturerCountry: string
  readonly manufacturerName: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategory
  readonly requiresColdChain: boolean
  readonly imageUrl?: string | null
  readonly descriptionTj?: string
  readonly descriptionRu?: string
  readonly substances: readonly { substanceId: string; strengthValue: number; strengthUnit: DosageUnit }[]
}

interface SeedData {
  readonly categories: readonly SeedCategory[]
  readonly substances: readonly SeedSubstance[]
  readonly medicines: readonly SeedMedicine[]
}

/** Re-export, чтобы не дублировать схемы. */
export type { SeedCatalogPort } from './seed-catalog.port.js'

function readSeedData(): SeedData {
  const categories = JSON.parse(readFileSync(join(DATA_DIR, 'categories.seed.json'), 'utf8')) as SeedCategory[]
  const substances = JSON.parse(readFileSync(join(DATA_DIR, 'substances.seed.json'), 'utf8')) as SeedSubstance[]
  const medicines = JSON.parse(readFileSync(join(DATA_DIR, 'medicines.seed.json'), 'utf8')) as SeedMedicine[]
  return { categories, substances, medicines }
}

/** Активный флаг в БД (миграция 0006 создаёт `categories.is_active BOOLEAN DEFAULT TRUE`). */
const CATEGORY_ACTIVE_TRUE = 1

/**
 * Идемпотентная вставка дерева категорий: возвращает slug → id, чтобы последующие
 * medicines могли резолвить `categoryId` по `categorySlug`. Порядок категорий в
 * JSON-файле гарантирует, что родители появляются раньше потомков (topological).
 */
async function insertCategories(
  port: SeedCatalogPort,
  categories: readonly SeedCategory[],
): Promise<Map<string, number>> {
  const idBySlug = new Map<string, number>()
  for (const cat of categories) {
    // eslint-disable-next-line no-await-in-loop -- порядок вставки категорий критичен: parent идёт раньше child (см. комментарий выше)
    const id = await port.insertCategory({
      parentId: cat.parentSlug ? (idBySlug.get(cat.parentSlug) ?? null) : null,
      slug: cat.slug,
      nameTj: cat.nameTj,
      nameRu: cat.nameRu,
      nameEn: cat.nameEn,
      commissionCategory: cat.commissionCategory,
      sortOrder: cat.sortOrder,
      isActive: CATEGORY_ACTIVE_TRUE,
    })
    idBySlug.set(cat.slug, id)
  }
  return idBySlug
}

/** Сплошная вставка substances (порядок не критичен, FK в `medicine_substances` проверит). */
async function insertSubstances(port: SeedCatalogPort, substances: readonly SeedSubstance[]): Promise<void> {
  await Promise.all(
    substances.map((sub) =>
      port.insertSubstance({
        id: sub.id,
        innName: sub.innName,
        innNameEn: sub.innNameEn ?? null,
      }),
    ),
  )
}

/** Преобразование `SeedMedicine` в плоский `MedicineRow`-insert. */
function buildMedicineInsert(medicine: Medicine, seed: SeedMedicine): Omit<MedicineRow, 'createdAt' | 'updatedAt' | 'searchVector'> {
  return {
    id: medicine.getId(),
    tradeName: medicine.getTradeName(),
    innName: medicine.getInnName(),
    barcode: seed.barcode ?? null,
    isGloballyIdentifiableByBarcode: medicine.isGloballyIdentifiableByBarcode(),
    categoryId: medicine.getCategoryId(),
    dosageForm: seed.dosageForm,
    dosageStrength: seed.dosageStrength,
    dosageFormClass: seed.dosageFormClass,
    manufacturerCountry: medicine.getManufacturerCountry(),
    manufacturerName: medicine.getManufacturerName(),
    isPrescriptionRequired: medicine.isPrescriptionRequired(),
    storageTemperature: null,
    descriptionTj: medicine.getDescriptionTj(),
    descriptionRu: medicine.getDescriptionRu(),
    imageUrl: medicine.getImageUrl(),
    dosageValue: null,
    dosageUnit: null,
    controlCategory: medicine.getControlCategory(),
    isPublished: true,
    requiresColdChain: medicine.requiresColdChain(),
  }
}

/** Сборка доменной команды и валидация. Бросает, если seed содержит невалидные данные. */
function buildValidatedMedicine(seed: SeedMedicine, categoryId: number): Medicine {
  const dosageFormResult = DosageForm.create(seed.dosageFormClass)
  if (!isOk(dosageFormResult)) {
    throw new Error(`Invalid dosage form class in seed: ${seed.dosageFormClass}`)
  }
  const result = Medicine.create({
    id: crypto.randomUUID(),
    tradeName: seed.tradeName,
    innName: seed.innName,
    categoryId,
    dosageForm: dosageFormResult.value,
    dosageStrengthRaw: seed.dosageStrength,
    manufacturerCountry: seed.manufacturerCountry,
    manufacturerName: seed.manufacturerName,
    isPrescriptionRequired: seed.isPrescriptionRequired,
    controlCategory: seed.controlCategory,
    requiresColdChain: seed.requiresColdChain,
    imageUrl: seed.imageUrl ?? null,
    descriptionTj: seed.descriptionTj ?? null,
    descriptionRu: seed.descriptionRu ?? null,
    substances: seed.substances,
  })
  if (!result.ok) {
    throw new Error(`Seed validation failed for "${seed.tradeName}": ${result.error.message}`)
  }
  return result.value
}

/** Вставка одной записи medicines + мост в `medicine_substances`. */
async function insertOneMedicine(
  port: SeedCatalogPort,
  seed: SeedMedicine,
  categoryId: number,
): Promise<void> {
  const medicine = buildValidatedMedicine(seed, categoryId)
  await port.insertMedicine(buildMedicineInsert(medicine, seed), seed.substances)
}

export async function runSeedCatalog(port: SeedCatalogPort): Promise<{ medicinesInserted: number }> {
  const data = readSeedData()
  const idBySlug = await insertCategories(port, data.categories)
  await insertSubstances(port, data.substances)

  // Счётчик медикаментов, реально добавленных ЭТИМ запуском. Само `insertMedicine`
  // молча no-op'ает на дубликате по логическому ключу (см. `DrizzleSeedCatalogPort`
  // и in-memory мок в тестах) — инкремент на каждой итерации цикла считал бы
  // «попыток вставки», а не фактических вставок, и расходился бы с реальным
  // состоянием порта при повторном запуске или при дублирующихся natural key
  // в самих seed-данных. `countMedicines()` до/после даёт честную разницу
  // независимо от причины no-op.
  const before = await port.countMedicines()
  for (const seed of data.medicines) {
    const categoryId = idBySlug.get(seed.categorySlug)
    if (categoryId === undefined) {
      throw new Error(`Unknown category slug: ${seed.categorySlug}`)
    }

    // параллельная вставка может упереться в ещё-не-вставленную категорию того же slug-пространства.
    // eslint-disable-next-line no-await-in-loop -- порядок medicines не критичен сам по себе, но sequence проще для отладки seed
    await insertOneMedicine(port, seed, categoryId)
  }
  const after = await port.countMedicines()
  return { medicinesInserted: after - before }
}

export const _RESET_MARKER = 'EP-04/DTJ-098'

/**
 * CLI entrypoint для `pnpm db:seed` (STATE-AND-RESUME-POINT.md §11.4 задача 3.3).
 *
 * Раньше этот блок был честным fail-fast — реализация `DrizzleSeedCatalogPort`
 * отсутствовала, и `pnpm db:seed` явно падал с ненулевым кодом, не маскируя
 * проблему под успех (см. AGENTS.md §3 «не отключай проверку ради зелёного
 * гейта»). Это закрывало дефект E из STATE §11.2 — было видно, что seed
 * не работает, но и не работало.
 *
 * Теперь (DTJ-098 follow-up) реализация `DrizzleSeedCatalogPort` добавлена
 * в `apps/api/src/db/seed/seed-catalog-drizzle-port.ts`. Этот main-блок:
 *   1. Проверяет `DATABASE_URL` (fail-fast с кодом 1, как `migrate.ts`).
 *   2. Создаёт порт через фабрику `createDrizzleSeedCatalogPort()` (та сама
 *      проверяет доступность БД через `SELECT 1`).
 *   3. Запускает `runSeedCatalog(port)` (идемпотентный, см. JSDoc выше).
 *   4. Закрывает пул в `finally`.
 *   5. Возвращает код 0 при успехе, 1 при ошибке.
 */
/**
 * DTJ-103 (EP-07): сидит 5 ключей блока аналогов (`catalog.analogs.*`) × 3 локали в
 * `i18n_overrides` — той же командой `pnpm db:seed` (правило 2 AGENTS.md, «написал
 * npm-скрипт → подключи и запусти», не отдельная незапускаемая команда). Вынесено в
 * отдельную функцию (не инлайн в `main()`), чтобы не раздувать `main()` за C1
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md`, ≤40 строк/метод).
 *
 * Отдельный pg.Pool/drizzle: `DrizzleSeedCatalogPort` не отдаёт наружу свой `db`
 * (закрытый конструктор порта, `seed-catalog-drizzle-port.ts`) — проще открыть
 * короткоживущее второе соединение на тот же `DATABASE_URL`, чем менять чужой
 * контракт порта ради одного дополнительного вызова.
 */
async function seedI18nOverridesCatalogViaCli(dbUrl: string): Promise<number> {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { Pool } = await import('pg')
  const { seedI18nOverridesCatalog } = await import('./i18n-overrides-catalog.seed.js')

  const pool = new Pool({ connectionString: dbUrl })
  try {
    const db = drizzle(pool)
    const result = await seedI18nOverridesCatalog(db)
    return result.upserted
  } finally {
    await pool.end().catch(() => undefined)
  }
}

/**
 * DTJ-352 (EP-15): сидит 2 обязательных R1-флага `feature_flags` той же командой `pnpm db:seed`
 * (правило 2 AGENTS.md). Отдельное короткоживущее соединение — тот же приём, что
 * `seedI18nOverridesCatalogViaCli` выше (см. её JSDoc про причину).
 */
async function seedFeatureFlagsViaCli(dbUrl: string): Promise<number> {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { Pool } = await import('pg')
  const { seedRequiredFeatureFlags } = await import('./feature-flags.seed.js')

  const pool = new Pool({ connectionString: dbUrl })
  try {
    const db = drizzle(pool)
    const result = await seedRequiredFeatureFlags(db)
    return result.inserted
  } finally {
    await pool.end().catch(() => undefined)
  }
}

/**
 * DTJ-369 (EP-16): сидит `notification_templates` (15 event_type × N каналов × 3 локали,
 * SRS-ADM-052) той же командой `pnpm db:seed` (правило 2 AGENTS.md). Отдельное короткоживущее
 * соединение — тот же приём, что `seedI18nOverridesCatalogViaCli`/`seedFeatureFlagsViaCli` выше.
 */
async function seedNotificationTemplatesViaCli(dbUrl: string): Promise<number> {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { Pool } = await import('pg')
  const { seedNotificationTemplates } = await import('./notification-templates/seed-notification-templates.js')

  const pool = new Pool({ connectionString: dbUrl })
  try {
    const db = drizzle(pool)
    const result = await seedNotificationTemplates(db)
    return result.upserted
  } finally {
    await pool.end().catch(() => undefined)
  }
}

async function main(): Promise<void> {
  // Защита от двойного запуска при импорте из тестов.
  if (process.env.DORUTJ_SEED_SKIP_MAIN === '1') return

  const dbUrl = process.env.DATABASE_URL
  if (dbUrl === undefined || dbUrl.length === 0) {
    // eslint-disable-next-line no-console -- CLI-скрипт, не часть Nest-приложения.
    console.error('DATABASE_URL is required for db:seed')
    process.exit(1)
  }

  // Импорт тут (не на верхнем уровне), чтобы избежать резолва `pg` при
  // юнит-тестировании `runSeedCatalog` с in-memory моком порта — там
  // Drizzle-порт не нужен.
  const { createDrizzleSeedCatalogPort } = await import('./seed-catalog-drizzle-port.js')

  let handle: Awaited<ReturnType<typeof createDrizzleSeedCatalogPort>> | null = null
  try {
    handle = await createDrizzleSeedCatalogPort()
    const result = await runSeedCatalog(handle.port)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(
      `[db:seed] OK — inserted ${String(result.medicinesInserted)} medicines (idempotent re-runs keep count stable)`,
    )
    const i18nUpserted = await seedI18nOverridesCatalogViaCli(dbUrl)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed] OK — upserted ${String(i18nUpserted)} catalog.analogs.* i18n_overrides rows (DTJ-103)`)
    const featureFlagsInserted = await seedFeatureFlagsViaCli(dbUrl)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed] OK — inserted ${String(featureFlagsInserted)} required R1 feature_flags rows (DTJ-352)`)
    const notificationTemplatesUpserted = await seedNotificationTemplatesViaCli(dbUrl)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed] OK — upserted ${String(notificationTemplatesUpserted)} notification_templates rows (DTJ-369)`)
    process.exitCode = 0
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error(`[db:seed] FAILED: ${message}`)
    process.exitCode = 1
  } finally {
    if (handle !== null) {
      await handle.close()
    }
  }
}

// Запуск только при прямом вызове: `tsx src/db/seed/seed-catalog.run.ts`.
// При импорте из тестов main НЕ выполняется (тест сам управляет port'ом).
const invokedDirectly = process.argv[1]?.endsWith('seed-catalog.run.ts') === true ||
  process.argv[1]?.endsWith('seed-catalog.run') === true
if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error('[db:seed] failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
