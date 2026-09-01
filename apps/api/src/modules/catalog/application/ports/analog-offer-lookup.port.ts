/**
 * Порт `AnalogOfferLookupPort` (DTJ-101, EP-07, R1) — read-модель,
 * агрегирующая данные `pharmacy_inventory` / `pharmacies` / `pharmacy_chains`
 * для подбора офферов аналогов в радиусе.
 *
 * Это **четвёртый** файл, нарушающий правило `dependency-cruiser`
 * `no-cross-module-deep-import` на уровне прямого SQL — три предыдущих
 * исключения (`postgres-search.adapter.ts` — поиск, `drizzle-pharmacy-inventory.
 * repository.ts` — Drizzle-репозиторий inventory, `composite-inventory-matcher.
 * service.ts` — composite-матчинг) уже зафиксированы архитектурно. Этот порт
 * — **допустимое расширение** исключения SRS-CAT-014 (см. ADR в задаче 3.5
 * `STATE-AND-RESUME-POINT.md` §11.4): только read, без записи и без
 * воспроизведения бизнес-инвариантов чужих агрегатов.
 *
 * **Архитектурное решение этого тикета.** В EP-07 на момент реализации ещё НЕ
 * существует `InventoryFacade`/`OnboardingFacade` с агрегатными методами
 * `getStockAndPriceBatch`/`isVisibleAndActive`. По согласованию с архитектором
 * (см. README эпика, раздел «Ключевые архитектурные решения этой зоны», п.3)
 * выбран **fallback-путь**: реализация через `NullAnalogOfferLookupAdapter`,
 * возвращающий пустой набор офферов. Это значит:
 *   - `findAnalogs` возвращает `items: []`, `savings: null` для ЛЮБОГО референса;
 *   - `hasAnalogs: false` в `GetMedicineDetailUseCase` (DTJ-095) остаётся
 *     консистентной заглушкой — внешний наблюдатель не отличает «нет аналогов»
 *     от «офферы ещё не подключены», и это правильно (лишний false negative
 *     лучше, чем неверный расчёт экономии).
 *
 * Реальная реализация (прямой SQL с согласованным ADR ИЛИ facade-оркестрация
 * после появления методов в `InventoryFacade`) — отдельный тикет, который
 * ЗАМЕНИТ `NullAnalogOfferLookupAdapter` через DI-биндинг в `catalog.module.ts`.
 *
 * **Контракт читаемости.** Внешние модули (presentation, orders) получают
 * `PharmacyOfferPublic[]` через `FindAnalogsUseCase.execute(...)` —
 * они НЕ зависят от того, как именно порт реализован (NullAdapter или
 * SQL-адаптер). Это сохраняет инвариант «замена реализации — смена DI-биндинга,
 * ноль изменений в use case / контроллере» (`02` §1.3).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, SRS-CAT-036, SRS-CAT-061)
 * @see docs/spec/10-domain-model.md (SRS-DOM-158/159)
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2 (долг 3.5)
 */
import type { PharmacyOfferPublic } from '@dorutj/contracts'

/**
 * Гео-точка пользователя (SRS-CAT-011). Широта/долгота в градусах, WGS-84.
 * Дубликат типа из `apps/api/src/shared-kernel/geo/geo-point.vo.ts` —
 * намеренно НЕ импортируем `shared-kernel` из `application`-порта
 * (нарушит направление зависимостей, см. AGENTS.md §5), и намеренно НЕ
 * дублируем VO в `packages/domain-kernel` — тип публичного контракта,
 * не доменный объект.
 */
export interface AnalogOfferGeoPoint {
  readonly lat: number
  readonly lon: number
}

/**
 * Входные параметры `getOffersForMedicines`.
 *
 * `radiusMeters` — обязателен (вызывающий передаёт `SEARCH_DEFAULT_RADIUS_METERS`
 * из `@dorutj/contracts`, если своего радиуса нет). `geo` опциональна: без
 * гео офферы возвращаются БЕЗ фильтра дистанции (только фильтр
 * `pharmacy.status='active'` И `pharmacy_chains.status IN ('approved','active')`,
 * см. SRS-CAT-010).
 */
export interface AnalogOfferLookupInput {
  readonly medicineIds: readonly string[]
  readonly geo?: AnalogOfferGeoPoint
  readonly radiusMeters: number
}

/**
 * DI-токен NestJS для `AnalogOfferLookupPort` (D-27: единый Symbol на пакет).
 * Используется в `FindAnalogsUseCase` через `@Inject(ANALOG_OFFER_LOOKUP_PORT)`.
 */
export const ANALOG_OFFER_LOOKUP_PORT = Symbol.for(
  '@dorutj/catalog/analog-offer-lookup-port',
)

/**
 * Контракт порта (DTJ-101).
 *
 * Возвращает `Map<medicineId, PharmacyOfferPublic[]>` для БАТЧЕВОЙ выборки
 * офферов. Гарантии:
 *   - ключи — ТОЛЬКО те `medicineId`, для которых найден хотя бы один оффер
 *     (отсутствующие ключи = отсутствие офферов в радиусе);
 *   - ВНУТРИ каждого ключа массив отсортирован по `priceDiram ASC`
 *     (SRS-DOM-158, единственный рубеж сортировки для аналогов);
 *   - все офферы прошли фильтр видимости `pharmacy.status='active'` И
 *     `pharmacy_chains.status IN ('approved','active')` (SRS-CAT-010).
 *     Это та же видимость, что в DTJ-100 для SQL-предфильтра, defense-in-depth.
 *
 * Реализация НЕ бросает исключение при пустом входном массиве — возвращает
 * пустой `Map`. Это нормальная ситуация (например, ни одного кандидата
 * аналогов не найдено в DTJ-100 → `getOffersForMedicines` не вызывается вовсе,
 * но контракт это поддерживает для устойчивости тестов).
 */
export interface AnalogOfferLookupPort {
  getOffersForMedicines(
    input: AnalogOfferLookupInput,
  ): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>>
}