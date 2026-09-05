/**
 * Порт `InventoryFacadePort` (EP-09, DTJ-220, SRS-ORD-018 шаг 4c/SRS-ORD-023).
 *
 * Межмодульный фасад `orders → inventory` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). `reserveStock`
 * — ЖЁСТКАЯ мутация остатка (списывает `pharmacy_inventory.quantity` по FEFO), вызывается ВНУТРИ
 * транзакции группы checkout (SRS-ORD-018 шаг 4c); недостаточно остатка на ЛЮБУЮ позицию группы →
 * `Result.err` с `ErrorCode.INSUFFICIENT_STOCK`/`EXPIRED_STOCK`, группа откатывается целиком, ОСТАЛЬНЫЕ
 * группы этого же checkout не затрагиваются (SRS-ORD-019, частичный успех по аптекам).
 *
 * `releaseStock` — компенсация (отмена заказа, откат при таймауте платежа, SRS-ORD-032..034) —
 * возвращает ранее зарезервированное количество обратно на партию.
 *
 * Реализация — адаптер поверх публичного фасада `modules/inventory/index.ts`, заводится
 * потребляющим тикетом (`CheckoutUseCase`, DTJ-227/`CancelOrderUseCase`, DTJ-232). Здесь —
 * ТОЛЬКО контракт (DTJ-220, скаффолдинг).
 *
 * РАСШИРЕНИЕ (DTJ-224, foundIssue — см. отчёт сдачи): `getStockQuantity` добавлен ЭТИМ тикетом.
 * `AvailabilityCalculator.getAvailableQuantity` (DTJ-224 «Что сделать» §3) буквально требует
 * «stockQuantity через InventoryFacadePort», но скаффолдинг DTJ-220 не заводил ни одного
 * READ-метода остатка на этом порте (только `reserveStock`/`releaseStock`/
 * `hasExpiredReservedBatch` — все три о РЕЗЕРВЕ, не о чтении текущего количества). Без этого
 * метода ticket DTJ-224 физически невыполним по буквальному тексту. Минимальная аддитивная
 * правка интерфейса (новый метод, ни один существующий не тронут) — тот же класс решения, что
 * D-EP09-9 (executor добавил код ошибки, отсутствующий в скаффолдинге, CTO задним числом
 * подтвердил). Зафиксировано в `disputed` отчёта DTJ-224 для CTO.
 */
import type { ErrorCode } from '@dorutj/contracts'
import type { Result } from '@dorutj/domain-kernel'
import type { OrderUnitOfWorkTx } from './order-repository.port.js'

/** DI-токен для провайдера `InventoryFacadePort`. */
export const INVENTORY_FACADE_PORT = Symbol.for('@dorutj/orders/inventory-facade')

export interface ReserveStockItemCommand {
  readonly medicineId: string
  readonly quantity: number
}

/**
 * Одна зарезервированная строка — какая партия (`pharmacy_inventory.id`) покрыла позицию (FEFO).
 *
 * `unitPriceDiram` (РАСШИРЕНИЕ, DTJ-227, foundIssue DTJ-220 — см. JSDoc `CatalogFacadePort`
 * «ВНИМАНИЕ» — `unitPriceDiram` перечислен в `MedicineOrderSnapshot`, но `CatalogFacade`
 * реального модуля `catalog` цены не несёт: она привязана к паре (pharmacy, medicine) через
 * `pharmacy_inventory`, а `getMedicineSnapshot(medicineIds)` структурно не принимает
 * `pharmacyId` — не может вернуть цену КОНКРЕТНОЙ аптеки для медикамента, продающегося в
 * нескольких). Разрешение: цена ПОЗИЦИИ заказа = цена ИМЕННО ТОГО лота, который резерв
 * реально списал (тот же race-free источник истины, что `inventoryBatchId`) — не отдельный
 * `getUnitPrice`-вызов ДО `reserveStock` (TOCTOU-окно между чтением цены и резервом лота с
 * ДРУГОЙ ценой). `OrderItem.inventoryBatchId` — ОДНА строка на позицию (домен, DTJ-221) —
 * поэтому `reserveStock` обязан выбрать РОВНО ОДИН лот на медикамент, покрывающий весь
 * `quantity` целиком (см. `InventoryFacadeAdapter`, `orders/infrastructure/adapters/`).
 */
export interface ReservedStockLine {
  readonly medicineId: string
  readonly inventoryBatchId: string
  readonly quantity: number
  readonly unitPriceDiram: bigint
}

/** Ошибка резерва — только коды, уже заведённые в общем каталоге (`packages/contracts/src/errors.ts`). */
export interface InventoryFacadeError {
  readonly code: ErrorCode.INSUFFICIENT_STOCK | ErrorCode.EXPIRED_STOCK
  readonly medicineId: string
}

export interface ReleaseStockItemCommand {
  readonly inventoryBatchId: string
  readonly quantity: number
}

/**
 * Ошибка `reserveForOrder` (DTJ-302) — набор кодов ýже, чем `InventoryFacadeError` выше:
 * `INSUFFICIENT_STOCK` там означает «FEFO не нашёл НИКАКОЙ подходящий лот» (поиск), здесь лот
 * УЖЕ известен (`batchId` — конкретная партия, отсканированная фармацевтом) — либо он валиден,
 * либо нет, семантика ближе к `422 BATCH_NOT_AVAILABLE` (SRS-PHT-014). Отдельный тип, НЕ
 * расширение union `InventoryFacadeError.code` — переиспользование поменяло бы контракт
 * существующего типа, потенциально ломая любой exhaustive-`switch` на двух текущих значениях.
 */
export interface BatchSubstitutionError {
  readonly code: ErrorCode.EXPIRED_STOCK | ErrorCode.BATCH_NOT_AVAILABLE
}

export interface InventoryFacadePort {
  /**
   * Жёсткий резерв остатка на ОДНУ аптеку (SRS-ORD-018 шаг 4c). ОДИН батч-вызов на группу.
   *
   * `tx` (РАСШИРЕНИЕ, DTJ-227, D-EP09-21) — опциональный дескриптор транзакции ГРУППЫ
   * checkout (`OrdersUnitOfWorkPort.run`), аддитивный параметр (существующие вызовы без него
   * не ломаются). Без него мутация остатка выполнялась бы НА ОТДЕЛЬНОМ соединении пула, вне
   * транзакции `Order.create()`/`save()` — провал ПОЗЖЕ в той же группе (например,
   * `OrderTotalMismatchError`) откатил бы заказ, но НЕ откатил бы уже списанный остаток
   * (тихая потеря товара). Реализация обязана выполнить UPDATE на переданном `tx`, не на
   * дефолтном пуле — см. `resolveDrizzleClient` (`orders/infrastructure/repositories/
   * drizzle-tx.util.ts`).
   */
  reserveStock(
    pharmacyId: string,
    items: readonly ReserveStockItemCommand[],
    tx?: OrderUnitOfWorkTx,
  ): Promise<Result<readonly ReservedStockLine[], InventoryFacadeError>>

  /** Компенсация резерва (отмена/откат, SRS-ORD-029..034). Идемпотентна для уже освобождённой партии. */
  releaseStock(items: readonly ReleaseStockItemCommand[], tx?: OrderUnitOfWorkTx): Promise<void>

  /**
   * DTJ-222 (SRS-DOM-006): `true`, если хотя бы одна партия, зарезервированная под `orderId`,
   * успела просрочиться (`expiry_date <= today`) к моменту `order.startProcessing()`. Домен не
   * вызывает порт напрямую (`02` §2.6) — `OrdersFacade.startProcessing()` резолвит флаг ДО вызова
   * `order.startProcessing()`. Реализация — владелец EP-05 (`modules/inventory`).
   *
   * D-EP09-16 (`reports/EP09-CTO-BRIEF.md`, решение CTO, отменяет прежнее «`always false` до
   * готовности реального адаптера»): это ЧТЕНИЕ-РАЗРЕШЕНИЕ (ответ на вопрос «можно ли»), не
   * чтение данных — у него нет безопасного дефолта. `false` от заглушки означало бы «просроченных
   * партий нет» и обходило бы REQ-REG-6 (запрет продажи просроченного товара). Заглушка порта
   * обязана БРОСАТЬ, не возвращать правдоподобное значение — см. `UnimplementedInventoryFacadeAdapter`
   * (`orders.module.ts`, TODO(DTJ-227)).
   */
  hasExpiredReservedBatch(orderId: string): Promise<boolean>

  /**
   * ДТЖ-224 (SRS-ORD-005..009): текущий физический остаток пары (аптека, медикамент) — сумма
   * `pharmacy_inventory.quantity` по непросроченным партиям. НЕ путать с `getMedicineSnapshot`
   * `CatalogFacadePort` (цена/Rx-статус, не остаток). Единственный потребитель —
   * `AvailabilityCalculator`, результат которого НИКОГДА не блокирует покупку (D-EP09-12 §2) —
   * несуществующая пара `(pharmacyId, medicineId)` → `0`, не исключение (тот же приём, что
   * `getMedicineSnapshot`: отсутствие в источнике не бросает, вызывающий решает сам).
   */
  getStockQuantity(pharmacyId: string, medicineId: string): Promise<number>

  /**
   * РАСШИРЕНИЕ (DTJ-302, foundIssue — тот же класс решения, что `getStockQuantity` выше:
   * «Минимальная аддитивная правка интерфейса (новый метод, ни один существующий не тронут) —
   * тот же класс решения, что D-EP09-9... Зафиксировано в disputed отчёта DTJ-224 для CTO»).
   * Тикет DTJ-302 предполагает `releaseReservation(oldBatchId, qty)` +
   * `reserveForOrder(newBatchId, qty)` как ДВЕ новые операции — проверено: «освободить РОВНО
   * известный `batchId` на известное `quantity`» уже 1:1 покрыто существующим `releaseStock`
   * выше (тот же вход `{inventoryBatchId, quantity}[]`, тот же эффект — вернуть количество на
   * партию); отдельный `releaseReservation` дублировал бы его без нового поведения (`02` §1.3:
   * «порт объявляется один раз»). Реально ОТСУТСТВУЕТ только «резервирование КОНКРЕТНОЙ, уже
   * известной партии» — `reserveStock` выше делает ПРОТИВОПОЛОЖНОЕ (сам ищет лот по FEFO для
   * `medicineId`, не принимает конкретный лот), непригодно для замены партии сканированием
   * (SRS-PHT-014: фармацевт УЖЕ читает номер серии физически с коробки — вторичный FEFO-поиск
   * мог бы выбрать ДРУГОЙ лот, не тот, что реально отсканирован).
   *
   * ВХОД — `(pharmacyId, medicineId, batchNumber)`, НЕ `batchId` (UUID): клиент терминала
   * (`ScanOrderItemRequestDto.scannedBatchNumber`) присылает человекочитаемый номер серии
   * (`pharmacy_inventory.batch_number`), не внутренний `id` — фармацевт физически читает номер
   * с упаковки, не UUID. Резолвинг «номер → строка» и резерв — ОДНА locked-операция (`SELECT
   * ... WHERE pharmacy_id/medicine_id/batch_number = ? FOR UPDATE`, тот же приём, что
   * `selectAndLockFefoBatch`), не два отдельных вызова (TOCTOU: строка могла обнулиться между
   * резолвом и резервом). Фильтр по `pharmacyId`+`medicineId` В САМОМ запросе даёт «та же аптека,
   * тот же товар» (SRS-PHT-014) БЕСПЛАТНО — отдельного сравнения после чтения не нужно: ни одна
   * строка не найдётся, если партия принадлежит другой аптеке.
   *
   * При успехе резервирует (списывает `quantity`) и возвращает РЕЗОЛВЛЕННЫЙ `batchId` — он
   * нужен вызывающему для `OrderItem.substituteBatch(batchId)` (домен хранит UUID, не номер).
   * Ошибки: партия не найдена ЛИБО чужой аптеки/медикамента (неотличимо снаружи, тот же приём,
   * что `OrderRepositoryPort.findById` — чужой тенант ⇒ как «не существует») → `BATCH_NOT_AVAILABLE`;
   * найдена, но просрочена (`ExpiryDate.isSellable`, буфер 0) → `EXPIRED_STOCK`; найдена и годна,
   * но `quantity` недостаточно → `BATCH_NOT_AVAILABLE`. Порядок вызова в use case: `reserveForOrder`
   * (новая партия) ВСЕГДА ДО `releaseStock` (старая) — если новая невалидна, старый резерв
   * остаётся нетронутым (TC-PHT-006: «резерв старой партии НЕ освобождён»), это БЕЗОПАСНЕЕ, чем
   * порядок, буквально перечисленный в тексте тикета.
   */
  reserveForOrder(
    pharmacyId: string,
    medicineId: string,
    batchNumber: string,
    quantity: number,
    tx?: OrderUnitOfWorkTx,
  ): Promise<Result<{ readonly batchId: string }, BatchSubstitutionError>>
}
