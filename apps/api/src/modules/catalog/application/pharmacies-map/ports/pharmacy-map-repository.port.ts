/**
 * Порт `PharmacyMapRepository` (DTJ-194, EP-08 — Карта аптек, `R1-6`).
 *
 * Поддиректория `catalog/application/pharmacies-map/` физически соседствует с `search/`
 * (DTJ-180), но объявляет СОБСТВЕННЫЙ порт — карта НЕ переиспользует `SearchProvider`:
 * критерий выборки другой (`bbox` — прямоугольник видимой области карты, `ST_MakeEnvelope`
 * + `&&` GiST-оператор, а не радиус вокруг точки, `ST_DWithin`), форма ответа другая
 * (статические данные аптеки + опциональная точечная цена/остаток ОДНОГО медикамента,
 * а не ранжированный список товаров). Смешивание портов ради формального переиспользования
 * сделало бы оба контракта менее выразительными (`00-EPICS.md`, владение EP-08).
 *
 * Единственная продакшен-реализация — Drizzle-адаптер (DTJ-195,
 * `infrastructure/adapters/pharmacy-map-repository.adapter.ts`). Use case (DTJ-196) и
 * презентационный контроллер (DTJ-198/199) зависят только от этого порта, не от адаптера.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-053, SRS-CAT-054)
 */
import type { TenantId } from '@/modules/tenancy/index.js'

/**
 * Максимальная площадь `bbox` в км² (SRS-CAT-054, ASSUMPTION — примерно весь Душанбе
 * с пригородом с запасом). `bbox`, покрывающий бо́льшую площадь, отклоняется
 * `400 VALIDATION_ERROR details.field='bbox'` — предотвращает случайный запрос
 * «вся территория Таджикистана» с клиента, уменьшенного до предела зума.
 *
 * Единственное место объявления (C6): геодезическая проверка площади перед SQL-запросом
 * выполняется `application`-use case'ом (DTJ-196), который импортирует эту константу
 * отсюда, а не дублирует значение.
 */
export const BBOX_MAX_AREA_KM2 = 2500

/** DI-токен NestJS для `PharmacyMapRepository`. */
export const PHARMACY_MAP_REPOSITORY = Symbol('PHARMACY_MAP_REPOSITORY')

/**
 * Параметры выборки пинов в границах видимой области карты (SRS-CAT-052).
 *
 * `medicineId` опционален: если передан — каждый возвращаемый пин обязан нести
 * цену/остаток именно ЭТОГО медикамента (сценарий «показать на карте» с карточки товара);
 * если не передан — пин несёт только статические данные аптеки (см. `PharmacyMapPin.offer`).
 * Проверка `площадь ≤ BBOX_MAX_AREA_KM2` — ответственность вызывающего use case, не порта.
 */
export interface BboxQuery {
  readonly lonMin: number
  readonly latMin: number
  readonly lonMax: number
  readonly latMax: number
  readonly medicineId?: string
  readonly tenantId: TenantId
}

/**
 * Один пин карты аптек (SRS-CAT-052). `offer === null` тогда и только тогда, когда
 * `BboxQuery.medicineId` не был передан — репозиторий не подтягивает цену/остаток,
 * если вызывающий код её не запросил (экономия JOIN, тот же принцип, что и SRS-CAT-050).
 */
export interface PharmacyMapPin {
  readonly pharmacyId: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly isOpenNow: boolean
  readonly is24x7: boolean
  readonly offer: {
    readonly priceDiram: number
    readonly stockQuantity: number
    readonly lastSyncedAt: string
    readonly isStale: boolean
  } | null
}

/**
 * Контракт репозитория карты аптек. Единственный метод — выборка пинов в границах `bbox`.
 */
export interface PharmacyMapRepository {
  findPinsInBbox(query: BboxQuery): Promise<readonly PharmacyMapPin[]>
}
