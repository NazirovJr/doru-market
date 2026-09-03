/**
 * Seed 5 ключей блока аналогов (`catalog.analogs.*`) в `i18n_overrides` — 3 локали
 * каждый, 15 строк (DTJ-103, EP-07, SRS-CAT-038..041).
 *
 * Тексты — ДОСЛОВНАЯ транскрипция из `docs/spec/20-module-catalog-search.md`:
 *   - `savings_banner` — SRS-CAT-038 (§6.4).
 *   - `disclaimer` — SRS-CAT-039 (§6.5) — ЮРИДИЧЕСКИЙ текст, побайтовое сравнение
 *     проверяется интеграционным тестом (`i18n-overrides-catalog.seed.integration.spec.ts`).
 *   - `rx_required_badge` — SRS-CAT-040.
 *   - `title_neutral` — RU дословно из SRS-CAT-037 (§6.3); TJ/EN — ASSUMPTION-перевод
 *     (спека даёт только RU-формулировку), помечены ниже.
 *   - `title_savings` — параметризованный шаблон `{{amount}}`; спека (SRS-CAT-037) даёт
 *     только неформальный пример «Сэкономьте X сомони», не полный i18n-текст на 3 языках —
 *     ASSUMPTION-шаблон по аналогии с `savings_banner`.
 *
 * Guillemets «…» в тексте спеки — типографские кавычки РАЗМЕТКИ ДОКУМЕНТА, не часть
 * значения ключа (тот же приём уже применён в кодовой базе: сравни
 * `docs/spec/30-ux-screens-and-flows.md:585` «Что-то пошло не так...» с фактическим
 * значением `ux.error.generic_500` в `packages/i18n/src/dictionaries/ru.json` — там
 * тоже без кавычек).
 *
 * **TJ-текст (`disclaimer`, `savings_banner`) — МАШИННЫЙ перевод, требует вычитки
 * НОСИТЕЛЕМ ЯЗЫКА/ФАРМАЦЕВТОМ до продакшен-релиза** (явная оговорка исходного
 * документа — DTJ-103 DoD, SRS-CAT-041). Этот тикет закрывает функциональный критерий
 * (текст присутствует, `review_status='pending_legal_review'`), не юридический
 * (текст утверждён юристом — переключение на `review_status='approved'` через
 * `apps/admin`, вне этого тикета).
 *
 * **Тенант.** Строки — ПЛАТФОРМЕННЫЙ (не White-Label-специфичный) контент блока
 * аналогов, сидятся под нейтральным тенантом (id зафиксирован ниже, заведён миграцией
 * `0021_seed_neutral_tenant.sql`). `TenantResolutionMiddleware` резолвит именно этот
 * тенант для любого запроса без явного White-Label домена — то есть для подавляющего
 * большинства публичных запросов `GET /medicines/:id/analogs`.
 *
 * **Почему НЕ дублируется в `packages/i18n/src/dictionaries/*.json` (отклонение от
 * files_owned DTJ-103).** Пути `packages/i18n/src/dictionaries/{tj,ru,en}/catalog.json`
 * из тикета предполагают неймспейс-структуру пакета, которой на момент реализации НЕТ:
 * реальный `packages/i18n` — три ПЛОСКИХ файла `{tj,ru,en}.json`
 * (`packages/i18n/src/use-t.ts`, `DICTIONARIES = { tj, ru, en }`), без подпапок по локали
 * и без merge-механизма нескольких неймспейс-файлов. Сам DTJ-103 предусматривает этот
 * случай («Что сделать» п.3): «если архитектура i18n уже определилась на ОДИН источник
 * истины ... этот пункт адаптируется под факт ... не дублировать один и тот же ключ в
 * обоих местах, выбрать одно place per ключ». Решение: ВСЕ 5 ключей — ТОЛЬКО здесь
 * (`i18n_overrides`), одним источником: `disclaimer` — юридический текст, обязан быть
 * версионируемым (SRS-CAT-041) и это единственный ключ, который реально резолвится
 * бэкендом (DTJ-102 читает ТОЛЬКО его); `titleKey`/`isPrescriptionRequired` (рефлекс
 * `rx_required_badge`) уходят в ответ API как ключ/булев флаг, а не резолвленный текст
 * (см. пример JSON в DTJ-102.md) — их резолвинг на фронтенде (DTJ-104, отдельный тикет,
 * вне этого объёма) НЕ заблокирован отсутствием статического словаря. Создание
 * НЕиспользуемых файлов `dictionaries/{tj,ru,en}/catalog.json` (не подключённых ни к
 * одному загрузчику) было бы ровно тем дефектом, который запрещает правило 2 AGENTS.md —
 * «написанный, но неподключённый код».
 *
 * Идемпотентность (DTJ-103 критерий): `INSERT ... ON CONFLICT (tenant_id, locale,
 * translation_key) DO UPDATE` — повторный запуск не создаёт дублей, обновляет
 * значение/`review_status`/`updated_at` на месте.
 *
 * Подключение к рантайму (правило 2 AGENTS.md): вызывается из `main()`
 * `seed-catalog.run.ts` (см. правку там) — `pnpm db:seed` сидит и каталог, и эти
 * 15 строк ОДНОЙ командой. Отдельный CLI-запуск (`tsx src/db/seed/
 * i18n-overrides-catalog.seed.ts`) тоже поддержан ниже — для случая, когда нужно
 * пересеять только этот блок без полного `db:seed`.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { i18nOverrides } from '@/db/schema/index.js'

/**
 * Нейтральный тенант — ЗАФИКСИРОВАННЫЙ UUID, заведён `0021_seed_neutral_tenant.sql`.
 * Дублируется тут (не импортируется из `apps/api/src/db/seed/tenants/neutral.seed.ts` —
 * там константа НЕ экспортирована, локальная `const` чужого тикета) тем же приёмом,
 * что уже применён в `0021_seed_neutral_tenant.sql` (комментарий: «id обязан быть один
 * и тот же во всех источниках»).
 */
export const I18N_SEED_NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'

type CatalogAnalogsLocale = 'tj' | 'ru' | 'en'

interface CatalogAnalogsSeedEntry {
  readonly translationKey: string
  readonly locale: CatalogAnalogsLocale
  readonly value: string
}

export const KEY_SAVINGS_BANNER = 'catalog.analogs.savings_banner'
export const KEY_TITLE_NEUTRAL = 'catalog.analogs.title_neutral'
export const KEY_TITLE_SAVINGS = 'catalog.analogs.title_savings'
export const KEY_DISCLAIMER = 'catalog.analogs.disclaimer'
export const KEY_RX_BADGE = 'catalog.analogs.rx_required_badge'

const CATALOG_ANALOGS_SEED_ENTRIES: readonly CatalogAnalogsSeedEntry[] = [
  // --- savings_banner (SRS-CAT-038, дословно RU/EN) ---
  {
    translationKey: KEY_SAVINGS_BANNER,
    locale: 'ru',
    value:
      'Сэкономьте {{amount}} сомони: найден аналог с тем же действующим веществом ' +
      '({{substanceNames}}) за {{cheapPrice}} сомони вместо {{refPrice}} сомони',
  },
  // ⚠ TJ — машинный перевод, требует вычитки носителем языка/фармацевтом до продакшен-релиза (SRS-CAT-038/041).
  {
    translationKey: KEY_SAVINGS_BANNER,
    locale: 'tj',
    value:
      '{{amount}} сомонӣ сарфа кунед: аналоги бо ҳамон моддаи фаъол ({{substanceNames}}) ' +
      'бо нархи {{cheapPrice}} сомонӣ ба ҷои {{refPrice}} сомонӣ ёфт шуд',
  },
  {
    translationKey: KEY_SAVINGS_BANNER,
    locale: 'en',
    value:
      'Save {{amount}} TJS: found an analog with the same active substance ' +
      '({{substanceNames}}) for {{cheapPrice}} TJS instead of {{refPrice}} TJS',
  },

  // --- title_neutral (SRS-CAT-037 §6.3 — RU дословно; TJ/EN — ASSUMPTION-перевод) ---
  { translationKey: KEY_TITLE_NEUTRAL, locale: 'ru', value: 'Другие варианты с тем же действующим веществом' },
  // ⚠ TJ — ASSUMPTION-перевод (спека даёт только RU-формулировку), требует вычитки носителем.
  { translationKey: KEY_TITLE_NEUTRAL, locale: 'tj', value: 'Дигар вариантҳо бо ҳамон моддаи фаъол' },
  { translationKey: KEY_TITLE_NEUTRAL, locale: 'en', value: 'Other options with the same active substance' },

  // --- title_savings (ASSUMPTION-шаблон: SRS-CAT-037 даёт только неформальный RU-пример
  //     «Сэкономьте X сомони»; параметризация {{amount}} по аналогии с savings_banner) ---
  { translationKey: KEY_TITLE_SAVINGS, locale: 'ru', value: 'Сэкономьте {{amount}} сомони' },
  // ⚠ TJ — ASSUMPTION-перевод, требует вычитки носителем.
  { translationKey: KEY_TITLE_SAVINGS, locale: 'tj', value: '{{amount}} сомонӣ сарфа кунед' },
  { translationKey: KEY_TITLE_SAVINGS, locale: 'en', value: 'Save {{amount}} TJS' },

  // --- disclaimer (SRS-CAT-039, ЮРИДИЧЕСКИЙ текст — побайтовая транскрипция, DoD DTJ-103) ---
  {
    translationKey: KEY_DISCLAIMER,
    locale: 'ru',
    value:
      'Это не медицинская рекомендация. Указанные препараты содержат одинаковый набор ' +
      'действующих веществ в равной дозировке, но могут отличаться вспомогательными ' +
      'веществами и производителем. Перед заменой препарата проконсультируйтесь с ' +
      'фармацевтом или врачом.',
  },
  // ⚠ TJ — машинный перевод, ТРЕБУЕТ ВЫЧИТКИ НОСИТЕЛЕМ ЯЗЫКА/ФАРМАЦЕВТОМ до продакшен-релиза
  // (явная оговорка SRS-CAT-039/041 и DoD DTJ-103 — не теряется при копировании).
  {
    translationKey: KEY_DISCLAIMER,
    locale: 'tj',
    value:
      'Ин тавсияи тиббӣ нест. Доруҳои нишондодашуда моддаҳои фаъоли якхела бо миқдори ' +
      'баробар доранд, аммо моддаҳои ёрирасон ва истеҳсолкунанда метавонанд фарқ кунанд. ' +
      'Пеш аз иваз кардани дору бо фармасевт ё духтур машварат кунед.',
  },
  {
    translationKey: KEY_DISCLAIMER,
    locale: 'en',
    value:
      'This is not medical advice. These products contain the same active substances at an ' +
      'equivalent strength, but may differ in excipients and manufacturer. Consult a ' +
      'pharmacist or doctor before switching medication.',
  },

  // --- rx_required_badge (SRS-CAT-040, дословно) ---
  { translationKey: KEY_RX_BADGE, locale: 'ru', value: 'Требуется рецепт' },
  { translationKey: KEY_RX_BADGE, locale: 'tj', value: 'Бо нусха' },
  { translationKey: KEY_RX_BADGE, locale: 'en', value: 'Prescription required' },
]

/** DoD DTJ-103: все сидовые записи входят с этим статусом (юрист визирует позже, apps/admin). */
const SEED_REVIEW_STATUS = 'pending_legal_review'

/**
 * Идемпотентный upsert 15 строк (5 ключей × 3 локали). Безопасно перезапускать —
 * повторный вызов обновляет `value`/`review_status`/`updated_at` на месте, не создаёт
 * дублей (DTJ-103 критерий приёмки, тест-план).
 */
export async function seedI18nOverridesCatalog(db: NodePgDatabase): Promise<{ upserted: number }> {
  for (const entry of CATALOG_ANALOGS_SEED_ENTRIES) {
    // eslint-disable-next-line no-await-in-loop -- 15 строк, seed-скрипт последователен по конвенции проекта (см. seed-catalog.run.ts insertCategories)
    await db
      .insert(i18nOverrides)
      .values({
        tenantId: I18N_SEED_NEUTRAL_TENANT_ID,
        locale: entry.locale,
        translationKey: entry.translationKey,
        value: entry.value,
        reviewStatus: SEED_REVIEW_STATUS,
      })
      .onConflictDoUpdate({
        target: [i18nOverrides.tenantId, i18nOverrides.locale, i18nOverrides.translationKey],
        set: { value: entry.value, reviewStatus: SEED_REVIEW_STATUS, updatedAt: new Date() },
      })
  }
  return { upserted: CATALOG_ANALOGS_SEED_ENTRIES.length }
}

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000

/**
 * Standalone CLI entrypoint (тот же приём, что `seed-catalog.run.ts:main()`) — позволяет
 * пересеять ТОЛЬКО этот блок без полного `pnpm db:seed`: `tsx src/db/seed/
 * i18n-overrides-catalog.seed.ts`. Основной путь подключения к рантайму — вызов из
 * `seed-catalog.run.ts:main()` (см. правку там), выполняемый штатной командой `pnpm db:seed`.
 */
async function main(): Promise<void> {
  if (process.env.DORUTJ_SEED_SKIP_MAIN === '1') return

  const dbUrl = process.env.DATABASE_URL
  if (dbUrl === undefined || dbUrl.length === 0) {
    // eslint-disable-next-line no-console -- CLI-скрипт, не часть Nest-приложения.
    console.error('DATABASE_URL is required for db:seed')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: DEFAULT_DB_CONNECT_TIMEOUT_MS })
  try {
    const db = drizzle(pool)
    const result = await seedI18nOverridesCatalog(db)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed:i18n] OK — upserted ${String(result.upserted)} catalog.analogs.* rows`)
    process.exitCode = 0
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error(`[db:seed:i18n] FAILED: ${message}`)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith('i18n-overrides-catalog.seed.ts') === true ||
  process.argv[1]?.endsWith('i18n-overrides-catalog.seed') === true
if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error('[db:seed:i18n] failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
