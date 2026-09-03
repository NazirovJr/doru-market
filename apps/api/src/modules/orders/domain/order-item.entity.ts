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
 */
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

/** Basis points знаменатель (100% = 10000 bps, SRS-DOM-160). Именованная константа — DoD п.4. */
const COMMISSION_BPS_DENOMINATOR = 10_000n

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
}

export class OrderItem {
  readonly id: string
  readonly medicineId: string
  readonly unitPrice: Money
  readonly quantity: number
  readonly totalPrice: Money
  readonly commissionBps: number
  readonly platformFeeDiram: bigint
  readonly inventoryBatchId: string

  private constructor(snapshot: OrderItemSnapshot) {
    this.id = snapshot.id
    this.medicineId = snapshot.medicineId
    this.unitPrice = snapshot.unitPrice
    this.quantity = snapshot.quantity
    this.totalPrice = snapshot.totalPrice
    this.commissionBps = snapshot.commissionBps
    this.platformFeeDiram = snapshot.platformFeeDiram
    this.inventoryBatchId = snapshot.inventoryBatchId
  }

  /**
   * `totalPrice = unitPrice.multiplyByQuantity(quantity)` — `Money` сам бросает
   * `InvalidMoneyError`, если `quantity` не целое положительное число (программная ошибка
   * вызывающего кода, не бизнес-правило — не оборачивается в `Result`, см. `02` §2.5).
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
      inventoryBatchId: this.inventoryBatchId,
    }
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
