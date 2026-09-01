/**
 * SQL-строитель `PostgresSearchProvider.suggest()` (DTJ-186, EP-06, R1, `SRS-CAT-027..029`).
 *
 * Отдельный файл от `postgres-search.adapter.ts` — тот же приём, что `postgres-search.sql.ts`
 * (DTJ-185, `search()`) будет использовать для собственного SQL: строитель запроса отделён от
 * DI-класса адаптера, чтобы каждый файл укладывался в C2 (`02-CLEAN-ARCHITECTURE-AND-CODE.md`).
 *
 * **Два пути (`SRS-CAT-029`, `SRS-DB-019`):**
 *   - `length(prefix) < SUGGEST_SHORT_PREFIX_THRESHOLD` (3) — ТОЛЬКО префиксный B-tree путь по
 *     `trade_name` через партиальный индекс `ix_medicines_trade_name_prefix` (DTJ-181). Триграммы
 *     на короткой строке неэффективны (`SRS-DB-019`) — эта ветка НЕ подмешивает `pg_trgm`.
 *   - `length(prefix) >= 3` — `pg_trgm`-похожесть (`%`-оператор) по `trade_name`/`inn_name`,
 *     `UNION ALL` с тем же префиксным условием, топ-`SUGGEST_CANDIDATE_POOL_SIZE` (30)
 *     промежуточных кандидатов по `raw_score DESC`, дедуп, финальный `LIMIT`.
 *
 * **Дедупликация — на уровне SQL** (`GROUP BY`/`DISTINCT ON lower(unaccent(trade_name))`), НЕ
 * постфактум в TypeScript (тикет, «Что сделать» п.3) — производительность (`SRS-CAT-061`,
 * p95 < 80мс). Канонический представитель группы — по приоритету `matchedVia`
 * (`prefix` > `trigram` > `inn`, `MATCHED_VIA_PRIORITY` ниже — единственный источник истины для
 * `CASE`-выражения в обоих местах, где нужна сортировка по приоритету) и, при равенстве —
 * по `raw_score DESC`. Геоприоритизация канонического представителя (prose `SRS-CAT-028`,
 * «максимальный offersCountInRadius, если geo передан») НЕ реализована — интерфейс порта
 * `SearchProvider.suggest(prefix, tenantId, limit)` не принимает `geo` (`SRS-CAT-011`), добавлять
 * необязательный параметр в обход декларированного интерфейса запрещено тикетом (см. «Риски»
 * DTJ-186) — расхождение prose/интерфейса фиксируется как известное ограничение R1.
 *
 * **Фильтр видимости** (`buildMedicinesVisibilityCondition`) — `is_published = true` +
 * исключение `control_category IN ('psychotropic','narcotic')` (`SRS-CAT-055`, тот же первый
 * рубеж обороны, что и в `search()`/`AnalogCandidatesAdapter`). ОТКЛОНЕНИЕ от буквального текста
 * тикета DTJ-186 п.5: «активная сеть/аптека» (JOIN `pharmacy_inventory`/`pharmacies`/
 * `pharmacy_chains`) НЕ включена — ЗАДОКУМЕНТИРОВАННОЕ ДОПУЩЕНИЕ:
 *   1. `suggest()` по `SRS-CAT-027` источником берёт ИСКЛЮЧИТЕЛЬНО `medicines.trade_name`/
 *      `inn_name` — ни одного поля из `inventory`/`onboarding` не возвращает.
 *   2. Право прямого `JOIN` через границу bounded context закреплено `SRS-CAT-014` персонально за
 *      `postgres-search.adapter.ts`/`search()` и требует согласованного точечного исключения в
 *      `.dependency-cruiser.cjs` (координация с EP-19, DTJ-185 «Definition of Done») — этот
 *      тикет (DTJ-186) такого пункта в своём DoD не содержит и не запрашивает правку конфига.
 *   3. Клик по подсказке ведёт на ПОЛНЫЙ `search()` по имени (`SRS-CAT-028`, «переход НЕ на
 *      medicine.id, а на `GET /medicines/search?text=`»), который применяет полный фильтр
 *      видимости — подсказка на препарат без текущего остатка не «протекает» дальше пустого
 *      результата полного поиска.
 * Если продукт решит, что подсказки обязаны отражать наличие остатков — это расширение scope,
 * согласуется отдельно с DTJ-185 (владелец исключения dependency-cruiser), не тихая правка здесь.
 *
 * **`pg_trgm.similarity_threshold`** — НЕ выставляется этим файлом. `SRS-DB-017` описывает его как
 * настройку уровня connection-pool hook (`infrastructure`, общая для ВСЕХ запросов через
 * `DRIZZLE_DB`), которую по «Что сделать» п.4 тикета DTJ-185 предстоит добавить. До готовности
 * DTJ-185 ветка `>=3` символов работает на дефолтном пороге PostgreSQL (`0.3`, не `0.20`) — это
 * временное, самоустраняющееся при мерже DTJ-185 расхождение, не дефект данного файла.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-027, SRS-CAT-028, SRS-CAT-029)
 * @see docs/spec/11-database-schema.md (SRS-DB-019, готовый запрос №1 — prefix-first стратегия)
 * @see tickets/ep05-search-map/DTJ-186.md
 */
import { sql, type SQL } from 'drizzle-orm'
import { medicines } from '@/db/schema/medicines.js'

/** `length(prefix) < 3` → префиксный B-tree путь (`SRS-CAT-029`, `SRS-DB-019`). */
export const SUGGEST_SHORT_PREFIX_THRESHOLD = 3

/** Топ-N промежуточных кандидатов ветки `>=3` до дедупликации (`SRS-CAT-029`). */
export const SUGGEST_CANDIDATE_POOL_SIZE = 30

/**
 * Приоритет канонического представителя дедуп-группы (`SRS-CAT-028`: «приоритет prefix > trigram
 * > inn»). Меньшее число — выше приоритет. Единственный источник истины для `CASE`-выражения,
 * генерируемого `matchedViaPriorityCase()` — держать оба места (там, где сортировка нужна дважды
 * внутри одного запроса) в согласии за счёт генерации, а не копипасты текста (C15 DRY).
 */
export const MATCHED_VIA_PRIORITY = {
  prefix: 0,
  trigram: 1,
  inn: 2,
} as const

/**
 * Сырая строка результата SQL (имена колонок — как в `SELECT ... AS`, snake_case).
 * `DrizzleDb.execute<T>` требует `T extends Record<string, unknown>`, а `tsc` не признаёт
 * `interface` без index signature удовлетворяющим этой границе (в отличие от `type`/литерала) —
 * вызывающая сторона (`postgres-search.adapter.ts`) инстанцирует `execute` как
 * `SuggestQueryRow & Record<string, unknown>`, не меняя это на `type` (ESLint
 * `consistent-type-definitions` требует `interface` для именованных форм объекта).
 */
export interface SuggestQueryRow {
  readonly id: string
  readonly trade_name: string
  readonly inn_name: string
  readonly matched_via: string
}

/**
 * Условие видимости (`is_published`/`control_category`) — переиспользуемая функция-строитель
 * (тикет DTJ-186 п.5, C15 DRY). По тексту тикета место назначения — `postgres-search.sql.ts`
 * (DTJ-185); на момент выполнения DTJ-186 этот файл ещё не существует (DTJ-185 не реализован,
 * `depends_on` DTJ-186 его не включает) — экспортирована здесь как временное каноническое место,
 * DTJ-185 переиспользует ЭТОТ экспорт (или переносит в свой файл, если архитектор решит иначе) —
 * см. шапку файла.
 */
export function buildMedicinesVisibilityCondition(): SQL {
  return sql`${medicines.isPublished} = true AND ${medicines.controlCategory} NOT IN ('psychotropic', 'narcotic')`
}

/** `CASE matched_via WHEN 'prefix' THEN 0 ...` — сгенерировано из `MATCHED_VIA_PRIORITY`. */
export function matchedViaPriorityCase(): SQL {
  const whens = Object.entries(MATCHED_VIA_PRIORITY)
    .map(([via, priority]) => `WHEN '${via}' THEN ${String(priority)}`)
    .join(' ')
  return sql.raw(`CASE matched_via ${whens} ELSE 99 END`)
}

/** UNION-ветвь: точный префикс `trade_name` (участвует в ОБОИХ путях — короткий и длинный). */
function buildPrefixCandidatesFragment(prefix: string): SQL {
  return sql`
    SELECT ${medicines.id} AS id, ${medicines.tradeName} AS trade_name, ${medicines.innName} AS inn_name,
      'prefix' AS matched_via, 1.0::real AS raw_score
    FROM ${medicines}
    WHERE ${buildMedicinesVisibilityCondition()}
      AND lower(unaccent(${medicines.tradeName})) LIKE lower(unaccent(${prefix})) || '%'
  `
}

/** UNION-ветвь: `pg_trgm`-похожесть по `trade_name` (только ветка `>=3` символов). */
function buildTradeNameTrigramFragment(prefix: string): SQL {
  return sql`
    SELECT ${medicines.id} AS id, ${medicines.tradeName} AS trade_name, ${medicines.innName} AS inn_name,
      'trigram' AS matched_via, similarity(unaccent(${medicines.tradeName}), unaccent(${prefix})) AS raw_score
    FROM ${medicines}
    WHERE ${buildMedicinesVisibilityCondition()}
      AND unaccent(${medicines.tradeName}) % unaccent(${prefix})
  `
}

/** UNION-ветвь: `pg_trgm`-похожесть по `inn_name` (только ветка `>=3` символов). */
function buildInnNameTrigramFragment(prefix: string): SQL {
  return sql`
    SELECT ${medicines.id} AS id, ${medicines.tradeName} AS trade_name, ${medicines.innName} AS inn_name,
      'inn' AS matched_via, similarity(unaccent(${medicines.innName}), unaccent(${prefix})) AS raw_score
    FROM ${medicines}
    WHERE ${buildMedicinesVisibilityCondition()}
      AND unaccent(${medicines.innName}) % unaccent(${prefix})
  `
}

/**
 * Короткая ветка (`length(prefix) < 3`, `SRS-CAT-029`): ТОЛЬКО префиксный B-tree путь, без
 * `pg_trgm` — `EXPLAIN` обязан показать Index Scan на `ix_medicines_trade_name_prefix`, не GIN
 * (DTJ-186 AC2). Дедуп — `DISTINCT ON` по той же нормализованной группе, что и длинная ветка.
 */
export function buildSuggestPrefixOnlyQuery(prefix: string, limit: number): SQL {
  return sql`
    SELECT DISTINCT ON (lower(unaccent(trade_name))) id, trade_name, inn_name, matched_via
    FROM (${buildPrefixCandidatesFragment(prefix)}) AS prefix_candidates
    ORDER BY lower(unaccent(trade_name)), id
    LIMIT ${limit}
  `
}

/**
 * Длинная ветка (`length(prefix) >= 3`, `SRS-CAT-029`): `UNION ALL` трёх источников → топ-
 * `SUGGEST_CANDIDATE_POOL_SIZE` по `raw_score DESC` → дедуп по приоритету `matchedVia` → финальный
 * `LIMIT`.
 */
export function buildSuggestTrigramUnionQuery(prefix: string, limit: number): SQL {
  const priorityCase = matchedViaPriorityCase()
  return sql`
    WITH candidates AS (
      ${buildPrefixCandidatesFragment(prefix)}
      UNION ALL
      ${buildTradeNameTrigramFragment(prefix)}
      UNION ALL
      ${buildInnNameTrigramFragment(prefix)}
    ), top_candidates AS (
      SELECT * FROM candidates ORDER BY raw_score DESC LIMIT ${SUGGEST_CANDIDATE_POOL_SIZE}
    ), deduped AS (
      SELECT DISTINCT ON (lower(unaccent(trade_name))) id, trade_name, inn_name, matched_via, raw_score
      FROM top_candidates
      ORDER BY lower(unaccent(trade_name)), ${priorityCase}, raw_score DESC
    )
    SELECT id, trade_name, inn_name, matched_via
    FROM deduped
    ORDER BY ${priorityCase}, raw_score DESC, lower(unaccent(trade_name))
    LIMIT ${limit}
  `
}

/** `true`, если запрос обязан идти по короткой (префиксной) ветке — чистая функция, unit-тест без БД. */
export function isSuggestShortPrefix(prefix: string): boolean {
  return prefix.length < SUGGEST_SHORT_PREFIX_THRESHOLD
}
