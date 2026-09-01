/**
 * `SearchCacheService` (DTJ-187, EP-06 «Умный поиск», SRS-CAT-058) — Redis-кэш результатов
 * поиска и автодополнения + read-only доступ к trending searches.
 *
 * **Слой.** Чистая infrastructure-утилита (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1) — без
 * бизнес-логики и доменных инвариантов, только сериализация/TTL/graceful degradation.
 * Потребители — `SearchMedicinesUseCase` (DTJ-188) и `SuggestMedicinesUseCase` (DTJ-189),
 * оба получают этот класс через конструктор DI (тикет DTJ-187, «Технический контекст»),
 * `new RedisClient()` внутри use case запрещён.
 *
 * **Ключи (SRS-CAT-058, таблица §11, дословно):**
 *   - Результаты поиска: `catalog:search:{tenantId}:{hash(text+filters+geo+radius+sort+
 *     cursor)}`, TTL по умолчанию `SEARCH_RESULTS_CACHE_TTL_SECONDS = 30`.
 *   - Автодополнение: `catalog:suggest:{tenantId}:{normalizedQuery}`, TTL по умолчанию
 *     `SUGGESTIONS_CACHE_TTL_SECONDS = 300`.
 *   - Trending searches: `trending_searches:{tenantId}` — ЧИТАЕТСЯ, не пишется, здесь
 *     (DTJ-187, «Что сделать» п.3). Наполняется джобой аналитики EP-17 (волна 11) — таблица
 *     ожидаемо пуста весь R1 до этой волны (риски DTJ-181), это НЕ баг ранжирования.
 *
 * **Стабильная сериализация ключа поиска (DTJ-187, критерий приёмки 3).** `buildSearchCacheKey`
 * сортирует ключи вложенных объектов РЕКУРСИВНО перед `JSON.stringify` — иначе
 * `{a:1,b:2}` и `{b:2,a:1}` (одинаковый по смыслу `filters`, разный порядок полей в
 * рантайме JS) дали бы разные хэши для семантически идентичного запроса.
 *
 * **Инвалидация — ПАССИВНАЯ** (TTL-истечение) для обоих ключей (`InventorySyncBatchCompletedEvent`
 * НЕ используется здесь — DTJ-187 «Что сделать» п.5, короткий TTL важнее точности, в отличие
 * от кэша карточки медикамента, EP-04, не этот тикет).
 *
 * **Graceful degradation.** Тот же приём, что `RedisTenantCacheAdapter`
 * (`modules/tenancy/infrastructure/adapters/tenant-cache.adapter.ts`, SRS-TEN-006), применённый
 * к кэшу поиска: любая ошибка Redis при ЧТЕНИИ (включая недоступность Redis и повреждённый
 * JSON) логируется `pino.warn` и трактуется как промах кэша — вызывающий код единообразно
 * идёт в реальный `SearchProvider`/локальную историю браузера. Это прямо требуется для
 * `getTrendingSearches` критерием приёмки 2 («ключ отсутствует → `[]` БЕЗ исключения») и
 * расширено на остальные читающие методы ради единообразия того же принципа «кэш —
 * оптимизация, не источник истины». Ошибка при ЗАПИСИ — логируется и глотается тем же образом.
 *
 * ASSUMPTION: формат значения под `trending_searches:{tenantId}` не специфицирован этим
 * тикетом (пишет джоба EP-17, вне scope DTJ-181/187) — здесь предполагается JSON-массив
 * строк, соответствующий возвращаемому типу `Promise<string[]>` (SRS-CAT-030).
 *
 * @see docs/spec/20-module-catalog-search.md (§11, SRS-CAT-058, SRS-CAT-030)
 * @see tickets/ep05-search-map/DTJ-187.md
 */
import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import type { Logger } from 'pino'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import type {
  SearchQuery,
  SearchResultPage,
  SuggestItem,
} from '@/modules/catalog/application/search/ports/search-provider.port.js'

/** SRS-CAT-058, таблица §11, строка «Результаты поиска». Именованная константа — не магическое число (C6). */
export const SEARCH_RESULTS_CACHE_TTL_SECONDS = 30
/** SRS-CAT-058, таблица §11, строка «Автодополнение». */
export const SUGGESTIONS_CACHE_TTL_SECONDS = 300

const SEARCH_CACHE_KEY_PREFIX = 'catalog:search:'
const SUGGEST_CACHE_KEY_PREFIX = 'catalog:suggest:'
const TRENDING_SEARCHES_KEY_PREFIX = 'trending_searches:'

/**
 * Вход для `buildSearchCacheKey` — сознательно ПЕРЕИСПОЛЬЗУЕТ поля `SearchQuery` (DTJ-180)
 * через `Pick`, а не дублирует их локальным типом (Ж12 `AGENTS.md`: копия типа там, где уже
 * есть оригинал, — дефект). `tenantId` здесь — строка (не VO `TenantId` из `tenancy`):
 * этот файл — общая инфраструктурная утилита кэша, не обязана знать о доменном VO соседнего
 * контекста ради самого факта построения текстового ключа Redis.
 */
export type SearchCacheKeyInput = Pick<SearchQuery, 'text' | 'filters' | 'geo' | 'radiusMeters' | 'sort' | 'cursor'> & {
  readonly tenantId: string
}

/**
 * Рекурсивно сортирует ключи объектов перед сериализацией (DTJ-187, критерий приёмки 3).
 * Массивы обходятся поэлементно, порядок элементов НЕ меняется (значим), примитивы — как есть.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const sourceRecord = value as Record<string, unknown>
    const sortedRecord: Record<string, unknown> = {}
    for (const key of Object.keys(sourceRecord).sort()) {
      sortedRecord[key] = sortKeysDeep(sourceRecord[key])
    }
    return sortedRecord
  }
  return value
}

/** Строит стабильный ключ кэша результатов поиска — `catalog:search:{tenantId}:{hash(...)}` (SRS-CAT-058). */
export function buildSearchCacheKey(input: SearchCacheKeyInput): string {
  const canonicalPayload = sortKeysDeep({
    text: input.text,
    filters: input.filters,
    geo: input.geo ?? null,
    radiusMeters: input.radiusMeters ?? null,
    sort: input.sort,
    cursor: input.cursor ?? null,
  })
  const hash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex')
  return `${SEARCH_CACHE_KEY_PREFIX}${input.tenantId}:${hash}`
}

/** Строит ключ кэша автодополнения — `catalog:suggest:{tenantId}:{normalizedQuery}` (SRS-CAT-058). */
export function buildSuggestCacheKey(tenantId: string, normalizedQuery: string): string {
  return `${SUGGEST_CACHE_KEY_PREFIX}${tenantId}:${normalizedQuery}`
}

@Injectable()
export class SearchCacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async getSearchResults(key: string): Promise<SearchResultPage | null> {
    return this.readJson<SearchResultPage>(key)
  }

  async setSearchResults(
    key: string,
    value: SearchResultPage,
    ttlSeconds: number = SEARCH_RESULTS_CACHE_TTL_SECONDS,
  ): Promise<void> {
    await this.writeJson(key, value, ttlSeconds)
  }

  async getSuggestions(key: string): Promise<readonly SuggestItem[] | null> {
    return this.readJson<readonly SuggestItem[]>(key)
  }

  async setSuggestions(
    key: string,
    value: readonly SuggestItem[],
    ttlSeconds: number = SUGGESTIONS_CACHE_TTL_SECONDS,
  ): Promise<void> {
    await this.writeJson(key, value, ttlSeconds)
  }

  /**
   * Read-only доступ к `trending_searches:{tenantId}` (SRS-CAT-030, SRS-CAT-058, DTJ-187 «Что
   * сделать» п.3). TTL/наполнение управляются джобой аналитики EP-17 — этот метод ТОЛЬКО
   * читает. Отсутствие ключа (джоба ещё не запускалась — ожидаемо весь R1 до волны 11) → `[]`,
   * НЕ исключение (критерий приёмки 2).
   */
  async getTrendingSearches(tenantId: string): Promise<string[]> {
    const cached = await this.readJson<string[]>(`${TRENDING_SEARCHES_KEY_PREFIX}${tenantId}`)
    return cached ?? []
  }

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key)
      return raw === null ? null : (JSON.parse(raw) as T)
    } catch (error: unknown) {
      this.logger.warn({ err: error, key }, 'search_cache_read_failed — деградация до промаха кэша')
      return null
    }
  }

  private async writeJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    } catch (error: unknown) {
      // Запись в кэш — оптимизация, не источник истины (см. JSDoc файла); провал НЕ должен
      // блокировать запрос пользователя (тот же приём, что RedisTenantCacheAdapter.setByKey).
      this.logger.warn({ err: error, key }, 'search_cache_write_failed')
    }
  }
}
