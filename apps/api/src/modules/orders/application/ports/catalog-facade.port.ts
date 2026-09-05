/**
 * Порт `CatalogFacadePort` (EP-09, DTJ-220, SRS-ORD-018 шаг 4b).
 *
 * Межмодульный фасад `orders → catalog` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: чужой
 * bounded context — только через порт, прямой импорт `modules/catalog/**` из `orders`
 * запрещён `dependency-cruiser` (`no-cross-module-deep-import`)). Реализация — адаптер,
 * делегирующий на публичный фасад `modules/catalog/index.ts` (`CatalogFacade`), заводится
 * потребляющим тикетом (`CheckoutUseCase`, DTJ-227), здесь — ТОЛЬКО контракт.
 *
 * `getMedicineSnapshot` вызывается на КАЖДОЙ группе checkout (SRS-ORD-018 шаг 4b) — цена и
 * Rx/control-статус берутся АКТУАЛЬНЫМИ на момент оформления, не из корзины (корзина могла
 * устареть между `GET /api/v1/cart` и `POST /api/v1/orders`).
 *
 * ВНИМАНИЕ (foundIssues DTJ-220): поле `unitPriceDiram` перечислено в тексте тикета DTJ-220
 * («getMedicineSnapshot(medicineIds) — актуальные unitPrice, isPrescriptionRequired,
 * controlCategory»), но доменный тип `catalog`-модуля `MedicineSnapshot`
 * (`modules/catalog/domain/medicine.types.ts`) цену НЕ несёт — цена в этой кодовой базе
 * привязана к паре (pharmacy, medicine) через `pharmacy_inventory`, не к самому медикаменту
 * глобально. Потребляющий тикет (DTJ-227/096) должен решить фактический источник
 * `unitPriceDiram` (вероятно — расширение `CatalogFacade.getMedicineSnapshot` на стороне
 * catalog с join на `pharmacy_inventory`, либо перенос поля в `InventoryFacadePort`). Контракт
 * здесь сохраняет поле по буквальному тексту тикета — решение архитектурного источника не
 * входит в объём DTJ-220 (скаффолдинг, только интерфейсы).
 */
import type { ControlCategoryPublic } from '@dorutj/contracts'

/** DI-токен для провайдера `CatalogFacadePort` (D-27: единый Symbol на порт). */
export const CATALOG_FACADE_PORT = Symbol.for('@dorutj/orders/catalog-facade')

/** Снимок медикамента на момент checkout — см. ВНИМАНИЕ в JSDoc файла про `unitPriceDiram`. */
export interface MedicineOrderSnapshot {
  readonly medicineId: string
  /**
   * Дефект приёмки DTJ-234 (найден при сдаче экрана корзины): ни этот снимок, ни какой-либо
   * DTO корзины не несли названия препарата — корзина рендерила `medicineId` (UUID) вместо
   * имени. Источник — `medicines.trade_name`, колонка `NOT NULL` (`db/schema/medicines.ts`),
   * прокинута через `CatalogFacade.getMedicineSnapshot` (`modules/catalog/index.ts`, уже несёт
   * `tradeName` в `MedicineSnapshot`) — здесь ОБЯЗАТЕЛЬНОЕ поле, не `| null`, ровно как в БД.
   */
  readonly tradeName: string
  readonly unitPriceDiram: bigint
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategoryPublic
}

export interface CatalogFacadePort {
  /**
   * Батч-снимок медикаментов по id (SRS-ORD-018 шаг 4b). Несуществующие id молча
   * пропускаются в возвращаемой `Map` — решение о том, что делать с отсутствующей записью
   * (исключить позицию из группы, вернуть ошибку), принимает вызывающий use case, не порт.
   */
  getMedicineSnapshot(medicineIds: readonly string[]): Promise<ReadonlyMap<string, MedicineOrderSnapshot>>

  /**
   * Множества действующих веществ по id медикамента (DTJ-223, SRS-ORD-004/SRS-DOM-175) —
   * используется `AddCartItemUseCase` для (а) проверки `controlCategory` через
   * `getMedicineSnapshot` и (б) детекции непустого пересечения веществ с уже лежащими в
   * корзине позициями (предупреждение `duplicate_substance`, добавление НЕ блокируется).
   *
   * ОТКЛОНЕНИЕ ОТ ТЕКСТА ТИКЕТА (foundIssues DTJ-223): DTJ-223 «Технический контекст»
   * описывает сигнатуру как `getSubstanceSet(medicineId)` (в единственном числе). Здесь —
   * батч по аналогии с `getMedicineSnapshot` выше и с уже существующим
   * `CatalogFacade.getSubstances(ids)` (`modules/catalog/index.ts`, DTJ-096): проверка
   * пересечения требует вещества НЕСКОЛЬКИХ медикаментов разом (новый + все текущие позиции
   * корзины), и единичный вызов на каждый медикамент — ровно тот N+1, которого этот проект
   * последовательно избегает (см. `pharmacy-sku-mapping.repository.port.ts`,
   * `inventory-facade.port.ts` и др.). Несуществующие id — как в `getMedicineSnapshot`,
   * молча пропускаются в `Map`.
   *
   * Реализация — адаптер поверх `CatalogFacade.getSubstances` (`modules/catalog/index.ts`),
   * заводится потребляющим тикетом (DTJ-223 — только контракт + мок в unit-тестах, реальная
   * проводка DI — риск, зафиксированный в отчёте сдачи DTJ-223: без адаптера токен
   * `CATALOG_FACADE_PORT` временно закрыт `NullAdapter`'ом в `orders.module.ts`,
   * `TODO(DTJ-227)`).
   *
   * ЗНАЧЕНИЕ карты (дефект приёмки DTJ-234) — `ReadonlyMap<substanceId, substanceName>`, не
   * `ReadonlySet<substanceId>`: предупреждение `duplicate_substance` (`AddCartItemUseCase`)
   * обязано назвать само вещество пользователю, id для этого не годится. Имя — `innName`
   * (`SubstanceRef`, `modules/catalog/domain/medicine.types.ts`), уже присутствует в данных,
   * которые адаптер получает от `CatalogFacade.getSubstances` — раньше отбрасывалось при
   * сведении к `Set`.
   */
  getSubstanceSet(medicineIds: readonly string[]): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>>

  /**
   * РАСШИРЕНИЕ (DTJ-302, foundIssue — тот же класс решения, что `getStockQuantity` на
   * `InventoryFacadePort`, зафиксированный в JSDoc того порта как «D-EP09-9», и подтверждённый
   * `disputed`-отчётом DTJ-224 для CTO: минимальная аддитивная правка интерфейса — новый метод,
   * ни один существующий не тронут). Тикет DTJ-302 называет `CatalogFacade.resolveMedicineByComposite(
   * barcode, tenantId)` «существующим методом» — проверено: `resolveMedicineByComposite`
   * РЕАЛЬНО существует (`modules/catalog/index.ts`, DTJ-097), но (а) сигнатура иная —
   * `(input: CompositeMatchInput)`, без `tenantId` вовсе; (б) `CompositeMatchInput.rawTradeName`
   * ОБЯЗАТЕЛЕН (`ResolveMedicineByCompositeUseCase.validateInput`, бросает
   * `InvalidCompositeMatchInputError` на пустой строке) — сканирование терминала фармацевта имеет
   * ТОЛЬКО сырой штрихкод, без названия препарата, поэтому реальный composite-матчинг (шаг
   * fuzzy-по-названию) структурно неприменим к этому вызову. Этот метод — узкий, специфичный
   * для сканирования контракт: точное совпадение по `medicines.barcode` (глобально
   * идентифицируемый EAN-13, `Barcode.isGloballyIdentifiable()`) ИЛИ, если штрихкод внутренний/
   * невалидный EAN-13 (D-06, SRS-DOM-076 — трактуется как `internal_sku`), точное совпадение в
   * `pharmacy_sku_mapping (pharmacy_id, internal_sku)` — кэш, уже используемый входящей 1С-
   * синхронизацией (EP-05, `pharmacy-sku-mapping.repository.port.ts`) для ТОЙ ЖЕ пары.
   * Реализация читает ОБЕ таблицы напрямую через `db/schema/**` (не публичный фасад
   * `modules/catalog/index.ts` — там нет подходящего метода, и не `modules/inventory/**` —
   * прямой импорт домена чужого модуля запрещён) — тот же приём, что `InventoryFacadeAdapter`
   * уже использует для `pharmacy_inventory`/`order_items` (см. его JSDoc «Нет публичного фасада
   * modules/inventory/index.ts»). `null` — штрихкод не резолвился НИКУДА (ни один путь не даёт
   * `medicineId`) — вызывающий (`ScanOrderItemUseCase`) трактует `null` как «не совпадает» точно
   * так же, как резолв в ЧУЖОЙ медикамент (оба ведут к `404 ORDER_ITEM_NOT_FOUND`, SRS-PHT-012).
   */
  resolveMedicineIdByBarcode(pharmacyId: string, rawBarcode: string): Promise<string | null>
}
