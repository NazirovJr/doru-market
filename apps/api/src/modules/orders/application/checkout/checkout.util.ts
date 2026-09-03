/**
 * Чистые хелперы + общие типы `CheckoutUseCase` (EP-09, DTJ-227) — вынесены из
 * `checkout.use-case.ts` ради `C2` (≤300 строк/файл, `02-CLEAN-ARCHITECTURE-AND-CODE.md`), тот
 * же приём, что вынос валидаторов `Order.create()` в `order-create.validators.ts` (DTJ-221).
 */
import type { BillingStrategy } from '@dorutj/contracts'
import type { IdGenerator } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderCreateCommand, OrderItemCommand } from '@/modules/orders/domain/order-create-command.js'
import type { MedicineOrderSnapshot } from '@/modules/orders/application/ports/catalog-facade.port.js'
import type { ReservedStockLine } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { PharmacyGroup } from '@/modules/orders/application/cart/split-cart-by-pharmacy.use-case.js'
import type { CartItemRecord } from '@/modules/orders/application/cart/ports/cart.repository.port.js'
import type { CheckoutCommand } from './dto/checkout-command.dto.js'
import type { CheckoutFailedGroupDto } from './dto/checkout-result.dto.js'
import type { OrderCostLineInput, OrderCostResult } from './calculate-order-cost.service.js'
import type { RxCheckItem } from './exclude-unverified-rx-items.service.js'
import type { CodPolicyItemInput } from '@/modules/orders/application/policies/cod-policy.service.js'

const ZERO_DIRAM_COD = 0n

export interface ResolvedAddress {
  readonly addressText: string
  readonly landmark: string | null
  readonly geoPoint: GeoPoint | null
}

/** Итог обработки ОДНОЙ группы checkout (см. `CheckoutUseCase.processGroup`). */
export type GroupOutcome =
  | { readonly kind: 'created'; readonly order: Order }
  | { readonly kind: 'failed'; readonly pharmacyId: string; readonly reason: string; readonly details?: Record<string, unknown> | undefined }

export function collectFailedGroups(outcomes: readonly GroupOutcome[]): CheckoutFailedGroupDto[] {
  return outcomes
    .filter((o): o is Extract<GroupOutcome, { kind: 'failed' }> => o.kind === 'failed')
    .map((o) => ({ pharmacyId: o.pharmacyId, reason: o.reason, details: o.details }))
}

/** Объект-параметр `buildItemCommands` (C5, `max-params` ≤3). */
export interface BuildItemCommandsInput {
  readonly group: PharmacyGroup
  readonly snapshots: ReadonlyMap<string, MedicineOrderSnapshot>
  readonly reservedLines: readonly ReservedStockLine[]
  readonly idGenerator: IdGenerator
  /** `CalculateOrderCostService.calculate()` (DTJ-228) — `commissionBps` резолвлен НА КАЖДУЮ позицию. */
  readonly commissionByMedicine: ReadonlyMap<string, number>
}

/**
 * Цена берётся из `reservedLines` (реальный лот, зарезервированный `InventoryFacadePort` —
 * race-free источник истины, см. JSDoc `ReservedStockLine`), НЕ из `snapshots` (справочная,
 * возможно устаревшая цена каталога). `commissionBps` — из `commissionByMedicine`
 * (`CalculateOrderCostService`, DTJ-228), обязателен на каждую позицию — отсутствие записи
 * такая же ошибка контракта адаптера, как отсутствие `reservedLines`.
 */
export function buildItemCommands(input: BuildItemCommandsInput): OrderItemCommand[] {
  const { group, snapshots, reservedLines, idGenerator, commissionByMedicine } = input
  const reservedByMedicine = new Map(reservedLines.map((line) => [line.medicineId, line]))
  return group.items.map((item) => {
    const reserved = reservedByMedicine.get(item.medicineId)
    if (reserved === undefined) {
      throw new Error(`reserveStock did not return a line for medicine ${item.medicineId} — adapter contract violation`)
    }
    const commissionBps = commissionByMedicine.get(item.medicineId)
    if (commissionBps === undefined) {
      throw new Error(`CalculateOrderCostService did not return a commission line for medicine ${item.medicineId} — contract violation`)
    }
    const snapshot = snapshots.get(item.medicineId)
    return {
      id: idGenerator.next(),
      medicineId: item.medicineId,
      pharmacyId: group.pharmacyId,
      unitPrice: Money.fromDiram(reserved.unitPriceDiram),
      quantity: item.quantity,
      commissionBps,
      inventoryBatchId: reserved.inventoryBatchId,
      isPrescriptionRequired: snapshot?.isPrescriptionRequired ?? false,
      controlCategory: snapshot?.controlCategory ?? 'none',
    }
  })
}

/**
 * Вход `CalculateOrderCostService.calculate()` (DTJ-228) — та же `reservedByMedicine`-логика,
 * что `buildItemCommands` (обе функции читают ОДИН и тот же `reservedLines`/`snapshots`,
 * независимо друг от друга — не общее мутируемое состояние, расхождения не может быть).
 */
export function buildCostInputItems(
  group: PharmacyGroup,
  reservedLines: readonly ReservedStockLine[],
  snapshots: ReadonlyMap<string, MedicineOrderSnapshot>,
): OrderCostLineInput[] {
  const reservedByMedicine = new Map(reservedLines.map((line) => [line.medicineId, line]))
  return group.items.map((item) => {
    const reserved = reservedByMedicine.get(item.medicineId)
    if (reserved === undefined) {
      throw new Error(`reserveStock did not return a line for medicine ${item.medicineId} — adapter contract violation`)
    }
    return {
      medicineId: item.medicineId,
      unitPriceDiram: reserved.unitPriceDiram,
      quantity: item.quantity,
      isPrescriptionRequired: snapshots.get(item.medicineId)?.isPrescriptionRequired ?? false,
    }
  })
}

/** Объект-параметр `buildOrderCreateCommand` (C5, `max-params` ≤3). */
export interface BuildOrderCreateCommandInput {
  readonly cmd: CheckoutCommand
  readonly group: PharmacyGroup
  readonly address: ResolvedAddress
  readonly items: OrderItemCommand[]
  readonly cost: OrderCostResult
  readonly billingStrategy: BillingStrategy
  readonly orderNumber: OrderNumber
  readonly codLimitDiram: bigint
  readonly idGenerator: IdGenerator
  readonly now: Date
}

const ZERO_DIRAM_UTIL = 0n

/** Собирает `OrderCreateCommand` (DTJ-228/229/230 «подключение») — итог `CalculateOrderCostService.calculate()`
 * (`cost.deliveryFeeDiram`) + позиции с уже резолвлённым `commissionBps` (`buildItemCommands`). */
export function buildOrderCreateCommand(input: BuildOrderCreateCommandInput): OrderCreateCommand {
  const { cmd, group, address, items, cost, billingStrategy, orderNumber, codLimitDiram, idGenerator, now } = input
  const deliveryFee = Money.fromDiram(cost.deliveryFeeDiram)
  const itemsTotal = items.reduce((sum, item) => sum.add(item.unitPrice.multiplyByQuantity(item.quantity)), Money.fromDiram(ZERO_DIRAM_UTIL))
  return {
    id: idGenerator.next(),
    orderNumber,
    tenantId: cmd.tenantId,
    customerId: cmd.customerId,
    pharmacyId: group.pharmacyId,
    items,
    deliveryAddress: address.addressText,
    deliveryLandmark: address.landmark,
    deliveryGeoPoint: address.geoPoint,
    deliveryFee,
    totalAmount: itemsTotal.add(deliveryFee),
    paymentMethod: cmd.paymentMethod,
    billingStrategy,
    // TODO(DTJ-230-follow-up): покрытие конкретных Rx-позиций конкретным рецептом — первый
    // переданный prescriptionId проброшен как есть; домен (`validatePrescriptionCoverage`)
    // всё равно требует его непустым при наличии Rx-позиции в группе.
    prescriptionId: cmd.prescriptionIds[0] ?? null,
    checkoutAttemptId: cmd.checkoutAttemptId,
    isPharmacyActiveAtCreation: true, // уже проверено `CheckoutUseCase.excludeInactivePharmacies` выше по стеку
    codLimitDiram,
    now,
  }
}

/** Application-слой, не domain (`02` §2.6 запрещает произвольную `Date`-арифметику только в domain). */
export function toDushanbeYYMMDD(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dushanbe',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}`
}

/** `PAYMENT_PROVIDER_TIMEOUT_MS` (ASSUMPTION 8000, ENV) — «Что сделать» п.2.4.d. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`operation timed out after ${String(ms)}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * D-25/D-EP09-35 (решение CTO) — программная ошибка, НЕ доменная: если после `Order.create()`
 * наличный заказ пришёл не в `confirmed` (или non-cash пришёл в `confirmed`), сломан домен, а
 * не пользовательский ввод. `Error`, НЕ `DomainError` — `AllExceptionsFilter` мапит
 * не-`DomainError` в `500 INTERNAL_ERROR` без попытки подобрать 4xx-код (см. JSDoc
 * `common/filters/all-exceptions.filter.ts`) — падать обязано громко.
 */
export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvariantViolationError'
  }
}

/**
 * DTJ-230 «Что сделать» п.3/4 — явная assertion, что `CheckoutUseCase` НИКОГДА не наблюдает
 * промежуточный `pending_payment` для `cash_courier` (SRS-ORD-027 п.1) и НИКОГДА `confirmed`
 * для non-cash (SRS-ORD-028). Сам переход уже гарантирован `Order.create()`
 * (DTJ-221/222) — это defense-in-depth на границе оркестрации, не повторная бизнес-проверка.
 */
export function assertOrderConfirmationInvariant(order: Order): void {
  const isCash = order.paymentMethod === 'cash_courier'
  if (isCash && order.status !== 'confirmed') {
    throw new InvariantViolationError(
      `D-25 invariant violated: cash_courier order ${order.id} has status='${order.status}' right after Order.create(), expected 'confirmed' (SRS-ORD-027 п.1)`,
    )
  }
  if (!isCash && order.status !== 'pending_payment') {
    throw new InvariantViolationError(
      `D-25 invariant violated: non-cash (${order.paymentMethod}) order ${order.id} has status='${order.status}' right after Order.create(), expected 'pending_payment' (SRS-ORD-028)`,
    )
  }
}

/** `MedicineOrderSnapshot` → минимальный вход `ExcludeUnverifiedRxItemsService.exclude()` (DTJ-230). */
export function toRxCheckItems(items: readonly CartItemRecord[], snapshots: ReadonlyMap<string, MedicineOrderSnapshot>): RxCheckItem[] {
  return items.map((item) => ({
    cartItemId: item.id,
    medicineId: item.medicineId,
    isPrescriptionRequired: snapshots.get(item.medicineId)?.isPrescriptionRequired ?? false,
  }))
}

/** Вход `CodPolicyService.isCodAllowed()` (DTJ-229) — preview-сумма по каталожной цене, без доставки (см. JSDoc вызывающего). */
export function buildCodPolicyInput(
  items: readonly CartItemRecord[],
  snapshots: ReadonlyMap<string, MedicineOrderSnapshot>,
): { codItems: CodPolicyItemInput[]; totalAmountDiram: bigint } {
  const codItems = items.map((item) => ({
    medicineId: item.medicineId,
    isPrescriptionRequired: snapshots.get(item.medicineId)?.isPrescriptionRequired ?? false,
  }))
  const totalAmountDiram = items.reduce(
    (sum, item) => sum + (snapshots.get(item.medicineId)?.unitPriceDiram ?? ZERO_DIRAM_COD) * BigInt(item.quantity),
    ZERO_DIRAM_COD,
  )
  return { codItems, totalAmountDiram }
}
