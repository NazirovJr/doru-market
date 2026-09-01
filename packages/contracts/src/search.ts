/**
 * Zod-схемы HTTP-контракта поиска каталога (DTJ-180, EP-06, R1, SRS-CAT-011).
 *
 * ОТДЕЛЬНЫЙ набор типов от порта `SearchProvider`
 * (`apps/api/src/modules/catalog/application/search/ports/search-provider.port.ts`).
 * Формы НЕ совпадают 1:1 НАМЕРЕННО: порт использует доменные VO (`TenantId`, `GeoPoint`) —
 * контракт здесь работает с сериализуемыми примитивами HTTP query-строки (`lat`/`lon`
 * вместо `geo: GeoPoint`, `tenantId` вовсе отсутствует — резолвится `TenantResolutionMiddleware`
 * из хоста/поддомена, клиент его не передаёт). Это единственный источник валидации на
 * границе API (`SearchQuerySchema.parse(...)`) — переиспользуется presentation-контроллером
 * (DTJ-190) и `apps/web` для типизации fetch-хуков (ticket DTJ-180, «Что сделать» п.5).
 *
 * **Правило дефолтов, применённое ниже.** Поле, помеченное в порту `?` (`SearchQuery.geo`,
 * `.radiusMeters`, `.cursor`; `SearchFilters.categoryId`, `.priceMinDiram`, `.priceMaxDiram`,
 * `.manufacturerName`, `.isPrescriptionRequired`), остаётся `.optional()` здесь без
 * навязанного дефолта — резолвинг (если он вообще нужен) остаётся use case'у
 * (`SearchMedicinesUseCase`, DTJ-183+), т.к. зависит от других полей (SRS-CAT-044: радиус
 * без `geo` тихо игнорируется, а не отклоняется). Поле БЕЗ `?` в порту получает `.default(...)`
 * здесь, если у него есть статический дефолт по SRS: `limit` (20, SRS-API-004),
 * `filters.inStockOnly/openNowOnly/is24x7Only` (`false`, §7.2/7.3), `text` (`''` — сам порт
 * документирует пустую строку как валидный режим «браузинг по фильтрам», §7/SRS-CAT-045).
 * Исключение — `sort`: SRS-CAT-048 задаёт дефолт `'relevance'` УСЛОВНО («при непустом text»);
 * статический безусловный дефолт `'relevance'` здесь — безопасная заглушка ДО TODO use case'а
 * DTJ-183, который волен пересчитать его для пустого `text`, не меняя эту схему (ASSUMPTION).
 *
 * Булевы флаги query-строки НЕ используют `z.coerce.boolean()` — та коэрсия идёт через
 * `Boolean(value)`, и непустая строка `'false'` стала бы `true` (тот же капкан, что
 * `MOCK_SMS_EXPOSE_CODE_IN_RESPONSE` в `apps/api/src/config/env.schema.ts` уже обходит через
 * `z.union([z.literal('true'), z.literal('false')])` — здесь тот же приём).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, SRS-CAT-044..048)
 * @see tickets/ep05-search-map/DTJ-180.md
 */
import { z } from 'zod'
import { cursorQuerySchema } from './pagination'

const LAT_MIN = -90
const LAT_MAX = 90
const LON_MIN = -180
const LON_MAX = 180

/**
 * Фиксированный набор радиусов селектора, метры (SRS-CAT-044) — не произвольный слайдер.
 * Каждое значение — отдельная именованная константа (C6 `no-magic-numbers`: числа внутри
 * массива не подпадают под `enforceConst`, только прямое значение `const X = N`).
 */
const RADIUS_METERS_1KM = 1000
const RADIUS_METERS_3KM = 3000
const RADIUS_METERS_5KM = 5000
const RADIUS_METERS_10KM = 10000
const RADIUS_METERS_20KM = 20000
const RADIUS_METERS_VALUES = [
  RADIUS_METERS_1KM,
  RADIUS_METERS_3KM,
  RADIUS_METERS_5KM,
  RADIUS_METERS_10KM,
  RADIUS_METERS_20KM,
] as const
type RadiusMeters = (typeof RADIUS_METERS_VALUES)[number]

function isAllowedRadiusMeters(value: number): value is RadiusMeters {
  return (RADIUS_METERS_VALUES as readonly number[]).includes(value)
}

const radiusMetersSchema = z.coerce.number().refine(isAllowedRadiusMeters, {
  message: `radiusMeters must be one of: ${RADIUS_METERS_VALUES.join(', ')}`,
})

/**
 * `z.preprocess` (не `.transform()` после `.optional()`): приводит query-строку `'true'`/`'false'`
 * к `boolean` ДО валидации самой `z.boolean()`. Всё остальное (уже-`boolean`, либо мусорная
 * строка вроде `'yes'`) передаётся как есть — `z.boolean()` ниже примет только настоящий
 * `boolean` и корректно отклонит остальное (НЕ `z.coerce.boolean()` — та коэрсия идёт через
 * `Boolean(value)`, и непустая строка `'false'` стала бы `true`, см. шапку файла).
 * `preprocess`, а не постфактум `.transform()`, важен и по другой причине: `.transform()` после
 * `.optional()` «теряет» пометку необязательности КЛЮЧА в выведенном типе (ключ остаётся
 * обязательным, просто со значением `T | undefined`) — из-за этого `SearchFiltersSchema.default(...)`
 * ниже потребовал бы explicit `isPrescriptionRequired: undefined` в дефолтном объекте. `preprocess`
 * оборачивает исходную `z.boolean()`/`z.boolean().optional()`, так что выведенный тип остаётся
 * чистым (`boolean` / `boolean | undefined` с настоящей необязательностью ключа).
 */
function normalizeBooleanQueryValue(value: unknown): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

/** Query-boolean с гарантированным дефолтом (SearchFilters.inStockOnly/openNowOnly/is24x7Only). */
function booleanFlagWithDefault(defaultValue: boolean) {
  return z.preprocess(normalizeBooleanQueryValue, z.boolean().default(defaultValue))
}

/** Query-boolean БЕЗ дефолта (SearchFilters.isPrescriptionRequired — истинно опционален в порту). */
const optionalBooleanFlagSchema = z.preprocess(normalizeBooleanQueryValue, z.boolean().optional())

/** Зеркало `SearchFilters` (порт, §7) — сериализуемые примитивы, имена полей идентичны. */
export const SearchFiltersSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  inStockOnly: booleanFlagWithDefault(false),
  openNowOnly: booleanFlagWithDefault(false),
  is24x7Only: booleanFlagWithDefault(false),
  priceMinDiram: z.coerce.number().int().nonnegative().optional(),
  priceMaxDiram: z.coerce.number().int().nonnegative().optional(),
  manufacturerName: z.string().min(1).optional(),
  isPrescriptionRequired: optionalBooleanFlagSchema,
})
export type SearchFiltersDto = z.infer<typeof SearchFiltersSchema>

/**
 * Query-параметры `GET /api/v1/medicines/search` (SRS-CAT-011). Расширяет переиспользуемую
 * `cursorQuerySchema` (`./pagination`) — `limit`/`cursor` НЕ дублируются заново (Ж12).
 */
export const SearchQuerySchema = cursorQuerySchema.extend({
  text: z.string().default(''),
  lat: z.coerce.number().min(LAT_MIN).max(LAT_MAX).optional(),
  lon: z.coerce.number().min(LON_MIN).max(LON_MAX).optional(),
  radiusMeters: radiusMetersSchema.optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'distance_asc']).default('relevance'),
  // Полностью развёрнутый дефолт (не `{}`): `.default(...)` подставляет значение КАК ЕСТЬ,
  // не прогоняя его повторно через `SearchFiltersSchema` — три обязательных (не-optional
  // в выведенном типе) флага обязаны присутствовать явно.
  filters: SearchFiltersSchema.default({ inStockOnly: false, openNowOnly: false, is24x7Only: false }),
})
export type SearchQueryDto = z.infer<typeof SearchQuerySchema>

/** Зеркало `PharmacyOffer` (порт). */
export const PharmacyOfferSchema = z.object({
  pharmacyId: z.string().min(1),
  pharmacyName: z.string().min(1),
  priceDiram: z.number().int().nonnegative(),
  stockQuantity: z.number().int().nonnegative(),
  distanceMeters: z.number().nonnegative().nullable(),
  /** ISO 8601 UTC (порт: `PharmacyOffer.lastSyncedAt`). */
  lastSyncedAt: z.string().min(1),
  isStale: z.boolean(),
})
export type PharmacyOfferDto = z.infer<typeof PharmacyOfferSchema>

/** Зеркало `SearchResultItem` (порт). */
export const SearchResultItemSchema = z.object({
  medicineId: z.string().min(1),
  tradeName: z.string().min(1),
  innName: z.string().min(1),
  dosageForm: z.string().min(1),
  dosageStrength: z.string().min(1),
  imageUrl: z.string().nullable(),
  isPrescriptionRequired: z.boolean(),
  cheapestOffer: PharmacyOfferSchema.nullable(),
  offersCountInRadius: z.number().int().nonnegative(),
  /** `0..1`, для отладки/аналитики, НЕ для UI (порт: `SearchResultItem.relevanceScore`). */
  relevanceScore: z.number().min(0).max(1),
})
export type SearchResultItemDto = z.infer<typeof SearchResultItemSchema>

/** Зеркало `SearchResultPage` (порт) — курсорная пагинация (SRS-API-004/005). */
export const SearchResultPageSchema = z.object({
  items: z.array(SearchResultItemSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})
export type SearchResultPageDto = z.infer<typeof SearchResultPageSchema>

/** Зеркало `SuggestItem` (порт, §5). */
export const SuggestItemSchema = z.object({
  medicineId: z.string().min(1),
  tradeName: z.string().min(1),
  innName: z.string().min(1),
  matchedVia: z.enum(['prefix', 'trigram', 'inn']),
})
export type SuggestItemDto = z.infer<typeof SuggestItemSchema>
