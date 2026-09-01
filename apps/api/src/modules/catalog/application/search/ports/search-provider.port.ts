/**
 * `SearchProvider` — порт поиска каталога (DTJ-180, EP-06 «Умный поиск + ранжирование +
 * автодополнение», R1). Слой `application` модуля `catalog`, поддиректория `search/`.
 *
 * **Почему поиск живёт ВНУТРИ `catalog`, а не в отдельном `modules/search`.** Решение
 * Tech Lead EP-06, зафиксированное тикетом DTJ-180 (раздел «Технический контекст»): карта
 * аптек (`20-module-catalog-search.md` §9, EP-08) и Analog Engine (§6, EP-07) уже физически
 * соседствуют в `catalog` — отдельный модуль поиска добавил бы только лишний фасад без
 * выигрыша в изоляции, а `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2 НЕ требует «один bounded
 * context = один NestJS-модуль». Это решение окончательное для волны 5 (DTJ-180 «Риски и
 * подводные камни») и не переоткрывается молча последующими тикетами — пересмотр только
 * через ADR к архитектору.
 *
 * **Конвенция порта** (`02` §1.3): `interface` + DI-токен `Symbol`. Реализации — в
 * `infrastructure/adapters/*.adapter.ts` (`PostgresSearchProvider`, DTJ-185;
 * `ElasticSearchProvider`, DTJ-191, R2), кроме временной `NullSearchProvider`, которая по
 * прямому указанию тикета DTJ-180 живёт рядом с портом, в `search/providers/` — см. её
 * собственный JSDoc. Связывание — единственно в `catalog.module.ts`
 * (`{ provide: SEARCH_PROVIDER, useFactory: ... }`), переключение по ENV `SEARCH_DRIVER`
 * (`SRS-CAT-012`).
 *
 * **Сигнатуры — дословно по `SRS-CAT-011`** (`docs/spec/20-module-catalog-search.md` §2.1).
 * Этот файл — точка синхронизации: следующие тикеты (DTJ-182..187, DTJ-191, DTJ-194) зависят
 * от ЭТОЙ формы, менять её позже — дорого. Никаких полей сверх специфицированных здесь.
 *
 * `TenantId` импортирован через публичный фасад `@/modules/tenancy` (`02` §1.2) — не
 * дублируется. `GeoPoint` импортирован из `@/shared-kernel` (чистый domain VO, ноль
 * инфраструктуры — легитимная зависимость `application → domain`, `02` §1.1), а НЕ
 * продублирован локальной фигурой `{ lat, lon }`: оба типа в коде-примере `SRS-CAT-011`
 * лишь ССЫЛАЮТСЯ, но не объявлены в нём — спецификация предполагает существующий
 * канонический источник, и Ж12 (`AGENTS.md`) запрещает копию VO там, где уже есть оригинал.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, SRS-CAT-012)
 * @see tickets/ep05-search-map/DTJ-180.md
 */
import type { TenantId } from '@/modules/tenancy/index.js'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'

/** DI-токен NestJS для `SearchProvider` (SRS-CAT-011, форма токена — дословно по спеке). */
export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER')

/**
 * Параметры поискового запроса (SRS-CAT-011). Собирается use case'ом
 * `SearchMedicinesUseCase` (DTJ-183+) из HTTP-контракта `@dorutj/contracts` `SearchQuerySchema`
 * — формы НЕ совпадают 1:1 (см. JSDoc `packages/contracts/src/search.ts`).
 */
export interface SearchQuery {
  readonly tenantId: TenantId
  /** `''` допустима — режим «браузинг по фильтрам», §7 (SRS-CAT-045). */
  readonly text: string
  readonly locale: 'tj' | 'ru' | 'en'
  readonly geo?: GeoPoint
  /** 1000..20000, дефолт `SEARCH_DEFAULT_RADIUS_METERS=5000` (`@dorutj/contracts`, §7.1). */
  readonly radiusMeters?: number
  readonly filters: SearchFilters
  readonly sort: 'relevance' | 'price_asc' | 'price_desc' | 'distance_asc'
  readonly cursor?: string
  /** 1..100, дефолт 20 (SRS-API-004). */
  readonly limit: number
}

/** Фильтры поискового запроса (SRS-CAT-011, §7). */
export interface SearchFilters {
  readonly categoryId?: number
  /** Дефолт `false` (§7.2, SRS-CAT-045). */
  readonly inStockOnly: boolean
  /** Дефолт `false` (§7.3, SRS-CAT-046). */
  readonly openNowOnly: boolean
  /** Дефолт `false` (§7.3, SRS-CAT-047). */
  readonly is24x7Only: boolean
  readonly priceMinDiram?: number
  readonly priceMaxDiram?: number
  readonly manufacturerName?: string
  readonly isPrescriptionRequired?: boolean
}

/** Один товар в результатах поиска (SRS-CAT-011). */
export interface SearchResultItem {
  readonly medicineId: string
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly imageUrl: string | null
  readonly isPrescriptionRequired: boolean
  /** `null` = ни одной активной аптеки не несёт товар в радиусе. */
  readonly cheapestOffer: PharmacyOffer | null
  readonly offersCountInRadius: number
  /** `0..1`, для отладки/аналитики, НЕ для UI (SRS-CAT-011). */
  readonly relevanceScore: number
}

/** Предложение одной аптеки по товару (SRS-CAT-011). */
export interface PharmacyOffer {
  readonly pharmacyId: string
  readonly pharmacyName: string
  readonly priceDiram: number
  readonly stockQuantity: number
  /** `null`, если `geo` не передан в запросе. */
  readonly distanceMeters: number | null
  /** ISO 8601 UTC. */
  readonly lastSyncedAt: string
  /** `now - lastSyncedAt > INVENTORY_DELTA_SLA_MINUTES * 3` (§7.5). */
  readonly isStale: boolean
}

/** Страница результатов поиска (SRS-CAT-011) — курсорная пагинация (SRS-API-004/005). */
export interface SearchResultPage {
  readonly items: readonly SearchResultItem[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

/** Один пункт автодополнения (SRS-CAT-011, §5). */
export interface SuggestItem {
  /** Канонический представитель дедуп-группы (§5, SRS-CAT-028). */
  readonly medicineId: string
  readonly tradeName: string
  readonly innName: string
  readonly matchedVia: 'prefix' | 'trigram' | 'inn'
}

/**
 * Контракт порта (SRS-CAT-011). Единственная точка входа для поиска и автодополнения —
 * `SearchMedicinesUseCase`/`SuggestMedicinesUseCase` (DTJ-183+) получают его через
 * конструктор по токену `SEARCH_PROVIDER`, `new` конкретного адаптера внутри use case
 * запрещён (`02` §1.3).
 */
export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResultPage>
  suggest(prefix: string, tenantId: TenantId, limit: number): Promise<readonly SuggestItem[]>
}
