/**
 * Порт `SearchQueryLogRepository` (EP-06, DTJ-188, `SRS-CAT-069`) — простой insert-порт
 * (не полноценный агрегат, DTJ-188 «Технический контекст») поверх таблицы `search_query_log`
 * (схема/миграция — DTJ-181, `@/db/schema/search-query-log.schema.js`, уже существует).
 *
 * **Почему отдельный порт, а не прямой `DrizzleDb` внутри use case.** `02-CLEAN-ARCHITECTURE-
 * AND-CODE.md` §1.1 запрещает `application` импортировать `infrastructure`/Drizzle напрямую —
 * `SearchMedicinesUseCase` получает запись через порт, как и все остальные зависимости
 * (`SEARCH_PROVIDER` и т.д.). Реализация — `infrastructure/adapters/search-query-log.adapter.ts`
 * (тот же тикет, тот же приём, что `AnalogCandidatesRepository`/`ANALOG_CANDIDATES_REPOSITORY`).
 *
 * **Единственный метод — `insert`.** Порт не читает `search_query_log` (trending-выборка —
 * ответственность `SearchCacheService.getTrendingSearches`, DTJ-187, читает Redis, не эту
 * таблицу напрямую; агрегация в trending — джоба EP-17, вне R1) и не обновляет `clicked_medicine_id`
 * (отдельное событие клика, вне scope DTJ-188).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-069, SRS-CAT-070)
 * @see tickets/ep05-search-map/DTJ-181.md
 * @see tickets/ep05-search-map/DTJ-188.md
 */

/** DI-токен NestJS для `SearchQueryLogRepository` (D-27: единый Symbol на пакет). */
export const SEARCH_QUERY_LOG_REPOSITORY = Symbol.for('@dorutj/catalog/search-query-log-repository')

/**
 * Один вызов поиска, готовый к записи (`SRS-CAT-069`). `queryText` — исходный текст ДО
 * нормализации (DTJ-188 «Что сделать» п.1е) — trending/аналитика должны видеть то, что реально
 * набрал пользователь, не транслитерированный/схлопнутый вариант.
 */
export interface SearchQueryLogEntry {
  readonly tenantId: string
  /** `null` — гостевой поиск без авторизации (`search-query-log.schema.ts`, `customerId`). */
  readonly customerId: string | null
  readonly queryText: string
  readonly resultsCount: number
}

/**
 * Контракт порта (DTJ-188). `insert` не возвращает созданную строку — вызывающему (use case)
 * не нужен `id`/`createdAt`, только факт записи (fire-and-forget с точки зрения бизнес-логики,
 * но НЕ проглатывается адаптером молча — ошибка Postgres пробрасывается вызывающему как есть,
 * решение «писать лог до или после ответа пользователю» остаётся за use case).
 */
export interface SearchQueryLogRepository {
  insert(entry: SearchQueryLogEntry): Promise<void>
}
