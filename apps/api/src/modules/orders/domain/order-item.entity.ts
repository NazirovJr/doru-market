/**
 * `OrderItem` (EP-09, DTJ-221, SRS-DOM-008/009, SRS-ORD-021/022) — сущность, подчинённая
 * агрегату `Order` (не отдельный агрегат, `10-domain-model.md` §«Order — слой domain»).
 *
 * `commissionBps`/`platformFeeDiram` — снэпшот на момент заказа (SRS-DOM-008): вычисляются
 * ОДИН раз в конструкторе, поле `readonly` — мутация после создания невозможна на уровне
 * компилятора (не рантайм-проверка, ровно то, что требует DoD тикета). `commissionBps`
 * приходит УЖЕ РЕЗОЛВЛЕННЫМ от вызывающего кода (`TenancyFacadePort.resolveCommissionRate`,
 * `application`-слой) — домен не импортирует порт (`02` §2.6), только считает округление
 * (SRS-ORD-022: банковское округление до целого дирама НА КАЖДУЮ позицию отдельно, не на
 * сумму заказа).
 *
 * `platformFeeDiram = round_half_to_even(unitPrice.diram × quantity × commissionBps / 10000)`.
 * Комиссия считается ИСКЛЮЧИТЕЛЬНО от `totalPrice` (= `unitPrice × quantity`), никогда от
 * `delivery_fee` (SRS-DOM-009) — формула не принимает `deliveryFee` параметром вовсе.
 *
 * **РАСШИРЕНИЕ (DTJ-302/303, EP-12, модуль 24 §A.3/A.4).** До этого тикета все поля были
 * `readonly` (DTJ-221: «позиции неизменяемы после создания», см. JSDoc `DrizzleOrderRepository`
 * до правки) — терминал фармацевта делает это предположение неверным: `fulfillmentStatus`/
 * `scannedBatchId`/... и, при замене партии, сам `inventoryBatchId` мутируют ПОСЛЕ создания
 * заказа. Приём — тот же, что `Order` уже использует для `_status` и других полей уровня
 * агрегата (приватное поле + геттер, мутация методом, не голым сеттером): `OrderItem` не
 * является отдельным агрегатом (см. абзац выше), но повторяет паттерн ради единообразия
 * инвариантов внутри одного файла/модуля (`02` C15).
 */
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { BusinessRuleViolationError, ItemAlreadyScannedError } from '@dorutj/contracts'
import type { OrderItemFulfillmentStatus } from './value-objects/order-item-fulfillment-status.vo.js'
import type { OrderItemIssueReason } from './order-domain-event.js'

/** Basis points знаменатель (100% = 10000 bps, SRS-DOM-160). Именованная константа — DoD п.4. */
const COMMISSION_BPS_DENOMINATOR = 10_000n

/** `order_items.scan_method` (DTJ-302, SRS-PHT-015/016) — как физически отсканирована позиция. */
export const SCAN_METHOD_VALUES = ['camera', 'manual'] as const
export type ScanMethod = (typeof SCAN_METHOD_VALUES)[number]

export interface OrderItemCreateProps {
  readonly id: string
  readonly medicineId: string
  readonly unitPrice: Money
  readonly quantity: number
  /** Уже резолвлённая ставка (basis points, 0..10000) — см. JSDoc файла. */
  readonly commissionBps: number
  readonly inventoryBatchId: string
}

export interface OrderItemSnapshot {
  readonly id: string
  readonly medicineId: string
  readonly unitPrice: Money
  readonly quantity: number
  readonly totalPrice: Money
  readonly commissionBps: number
  readonly platformFeeDiram: bigint
  readonly inventoryBatchId: string
  /** DTJ-302/303 (`[РАСШИРЕНИЕ]`, SRS-PHT-002/011..020) — прогресс сборки этой позиции. */
  readonly fulfillmentStatus: OrderItemFulfillmentStatus
  readonly scannedBatchId: string | null
  readonly scannedAt: Date | null
  readonly scannedBy: string | null
  readonly scanMethod: ScanMethod | null
  readonly itemIssueReason: OrderItemIssueReason | null
}

export class OrderItem {
  readonly id: string
  readonly medicineId: string
  readonly unitPrice: Money
  readonly quantity: number
  readonly totalPrice: Money
  readonly commissionBps: number
  readonly platformFeeDiram: bigint
  private _inventoryBatchId: string
  private _fulfillmentStatus: OrderItemFulfillmentStatus
  private _scannedBatchId: string | null
  private _scannedAt: Date | null
  private _scannedBy: string | null
  private _scanMethod: ScanMethod | null
  private _itemIssueReason: OrderItemIssueReason | null

  private constructor(snapshot: OrderItemSnapshot) {
    this.id = snapshot.id
    this.medicineId = snapshot.medicineId
    this.unitPrice = snapshot.unitPrice
    this.quantity = snapshot.quantity
    this.totalPrice = snapshot.totalPrice
    this.commissionBps = snapshot.commissionBps
    this.platformFeeDiram = snapshot.platformFeeDiram
    this._inventoryBatchId = snapshot.inventoryBatchId
    this._fulfillmentStatus = snapshot.fulfillmentStatus
    this._scannedBatchId = snapshot.scannedBatchId
    this._scannedAt = snapshot.scannedAt
    this._scannedBy = snapshot.scannedBy
    this._scanMethod = snapshot.scanMethod
    this._itemIssueReason = snapshot.itemIssueReason
  }

  /** Партия, реально покрывающая позицию сейчас — FEFO-резерв checkout ИЛИ замена сканирования. */
  get inventoryBatchId(): string {
    return this._inventoryBatchId
  }

  get fulfillmentStatus(): OrderItemFulfillmentStatus {
    return this._fulfillmentStatus
  }

  get scannedBatchId(): string | null {
    return this._scannedBatchId
  }

  get scannedAt(): Date | null {
    return this._scannedAt
  }

  get scannedBy(): string | null {
    return this._scannedBy
  }

  get scanMethod(): ScanMethod | null {
    return this._scanMethod
  }

  get itemIssueReason(): OrderItemIssueReason | null {
    return this._itemIssueReason
  }

  /**
   * `totalPrice = unitPrice.multiplyByQuantity(quantity)` — `Money` сам бросает
   * `InvalidMoneyError`, если `quantity` не целое положительное число (программная ошибка
   * вызывающего кода, не бизнес-правило — не оборачивается в `Result`, см. `02` §2.5).
   *
   * Новая позиция всегда стартует `fulfillmentStatus='pending'`, поля сканирования — `null`
   * (DTJ-302/303, `[РАСШИРЕНИЕ]`). `OrderItemCreateProps` НЕ расширяется этими полями —
   * checkout (вызывающий код) не обязан знать о терминале фармацевта (DRY, `02` C15).
   */
  static create(props: OrderItemCreateProps): OrderItem {
    validateCommissionBps(props.commissionBps)
    const totalPrice = props.unitPrice.multiplyByQuantity(props.quantity)
    const platformFeeDiram = bankersRoundDivide(
      totalPrice.diram * BigInt(props.commissionBps),
      COMMISSION_BPS_DENOMINATOR,
    )
    return new OrderItem({
      id: props.id,
      medicineId: props.medicineId,
      unitPrice: props.unitPrice,
      quantity: props.quantity,
      totalPrice,
      commissionBps: props.commissionBps,
      platformFeeDiram,
      inventoryBatchId: props.inventoryBatchId,
      fulfillmentStatus: 'pending',
      scannedBatchId: null,
      scannedAt: null,
      scannedBy: null,
      scanMethod: null,
      itemIssueReason: null,
    })
  }

  /** Восстановление из персистентного снимка (репозиторий) — без повторной валидации. */
  static restore(snapshot: OrderItemSnapshot): OrderItem {
    return new OrderItem(snapshot)
  }

  toSnapshot(): OrderItemSnapshot {
    return {
      id: this.id,
      medicineId: this.medicineId,
      unitPrice: this.unitPrice,
      quantity: this.quantity,
      totalPrice: this.totalPrice,
      commissionBps: this.commissionBps,
      platformFeeDiram: this.platformFeeDiram,
      inventoryBatchId: this._inventoryBatchId,
      fulfillmentStatus: this._fulfillmentStatus,
      scannedBatchId: this._scannedBatchId,
      scannedAt: this._scannedAt,
      scannedBy: this._scannedBy,
      scanMethod: this._scanMethod,
      itemIssueReason: this._itemIssueReason,
    }
  }

  /**
   * DTJ-302 (SRS-PHT-013) — guard пайплайна `scan`: «решение по позиции ещё не принято».
   * Публичный (не `private`), т.к. `ScanOrderItemUseCase` обязан вызвать его РАНЬШЕ проверки
   * партии (пайплайн-шаг «г» ДО шага «д», SRS-PHT-013 предшествует SRS-PHT-014) — иначе
   * `InventoryFacade` был бы задет на уже решённой позиции. `substituteBatch`/`markScannedOk`
   * ниже вызывают его же повторно (защита от прямого вызова в обход пайплайна, `02` §2.5:
   * домен — последняя линия защиты инварианта, не только use case).
   */
  assertPending(): void {
    if (this._fulfillmentStatus !== 'pending') {
      throw new ItemAlreadyScannedError({ orderItemId: this.id, currentStatus: this._fulfillmentStatus })
    }
  }

  /**
   * DTJ-302 (SRS-PHT-014) — заменяет партию, покрывающую эту позицию (после того, как use case
   * уже выполнил `InventoryFacade.releaseStock(old)`+`reserveForOrder(new)` успешно). Только
   * `inventoryBatchId` — `scannedBatchId` проставляет `markScannedOk` ниже (шаг 6 читает уже
   * актуальный `inventoryBatchId`, замена или нет — эта сущность не хранит два разных факта).
   */
  substituteBatch(newBatchId: string): void {
    this.assertPending()
    this._inventoryBatchId = newBatchId
  }

  /** DTJ-302 (SRS-PHT-015) — пайплайн `scan` завершился успехом (шаг 6). */
  markScannedOk(params: {
    readonly scannedAt: Date
    readonly scannedBy: string
    readonly scanMethod: ScanMethod
  }): void {
    this.assertPending()
    this._fulfillmentStatus = 'scanned_ok'
    this._scannedBatchId = this._inventoryBatchId
    this._scannedAt = params.scannedAt
    this._scannedBy = params.scannedBy
    this._scanMethod = params.scanMethod
  }

  /**
   * DTJ-303 (SRS-PHT-017/018) — фармацевт сообщил, что позицию физически невозможно
   * укомплектовать. Код ошибки guard'а — `422 BUSINESS_RULE_VIOLATION`, НЕ `409
   * ITEM_ALREADY_SCANNED` (в отличие от `assertPending()` выше) — тикет DTJ-303 буквально
   * называет именно этот код для precondition-нарушения `report-issue`, отдельно от кода
   * `scan`; не общий `assertPending()`, чтобы не унести за собой чужой HTTP-статус.
   */
  markUnavailable(reason: OrderItemIssueReason): void {
    if (this._fulfillmentStatus !== 'pending') {
      throw new BusinessRuleViolationError('Order item is not pending, cannot report an issue', {
        orderItemId: this.id,
        currentStatus: this._fulfillmentStatus,
      })
    }
    this._fulfillmentStatus = 'unavailable'
    this._itemIssueReason = reason
  }
}

function validateCommissionBps(commissionBps: number): void {
  const MIN_BPS = 0
  const MAX_BPS = 10_000
  if (!Number.isInteger(commissionBps) || commissionBps < MIN_BPS || commissionBps > MAX_BPS) {
    throw new Error(`commissionBps must be an integer in [${String(MIN_BPS)}, ${String(MAX_BPS)}], got ${String(commissionBps)}`)
  }
}

/**
 * Целочисленное деление с банковским округлением (round half to even) — без единого `float`
 * (правило 6 AGENTS.md). `remainder*2 vs denominator` избегает деления с плавающей точкой при
 * сравнении дробной части с `0.5`.
 */
const TWO = 2n
const ONE = 1n
const ZERO = 0n

function bankersRoundDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const twiceRemainder = remainder * TWO
  if (twiceRemainder < denominator) {
    return quotient
  }
  if (twiceRemainder > denominator) {
    return quotient + ONE
  }
  // Ровно половина дирама — округление к чётному.
  return quotient % TWO === ZERO ? quotient : quotient + ONE
}
