/**
 * Инварианты создания `Order` (EP-09, DTJ-221, SRS-DOM-002/003/004/005/007/012/156).
 * Вынесены из `order.entity.ts` ради `C2` (≤300 строк/файл) — `Order.create()` вызывает эти
 * функции ПО ПОРЯДКУ (см. DTJ-221 «Что сделать» п.4), останавливаясь на первой ошибке.
 *
 * Каждая функция — чистая (без I/O), возвращает `DomainError | null` (`null` = инвариант
 * соблюдён). Ошибки — уже существующие классы `@dorutj/contracts` (`reports/EP09-CTO-BRIEF.md`
 * §5: «коды ошибок заказов уже в errors.ts» — не плодить синонимы).
 */
import {
  CodForbiddenForRxError,
  CodLimitExceededError,
  ControlledSubstanceNotOrderableError,
  type DomainError,
  OrderPharmacyMismatchError,
  OrderTotalMismatchError,
  PharmacySuspendedError,
  PrescriptionNotVerifiedError,
  ValidationError,
} from '@dorutj/contracts'
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { OrderCreateCommand } from './order-create-command.js'

const CONTROLLED_CATEGORIES = new Set(['psychotropic', 'narcotic'])

/** Заказ обязан содержать хотя бы одну позицию (структурная предпосылка, не отдельный SRS). */
export function validateNonEmptyItems(cmd: OrderCreateCommand): DomainError | null {
  if (cmd.items.length === 0) {
    return new ValidationError('Order must contain at least one item', { orderId: cmd.id })
  }
  return null
}

/** SRS-DOM-002 — defensive-проверка: `SplitCartByPharmacyUseCase` уже гарантирует это выше по стеку. */
export function validateSinglePharmacy(cmd: OrderCreateCommand): DomainError | null {
  const mismatched = cmd.items.find((item) => item.pharmacyId !== cmd.pharmacyId)
  if (mismatched !== undefined) {
    return new OrderPharmacyMismatchError({
      orderId: cmd.id,
      expectedPharmacyId: cmd.pharmacyId,
      actualPharmacyId: mismatched.pharmacyId,
      medicineId: mismatched.medicineId,
    })
  }
  return null
}

/** SRS-DOM-003 — `total_amount = items_total + delivery_fee`, вычислено сервером, сверено с cmd. */
export function validateTotalAmount(cmd: OrderCreateCommand, itemsTotal: Money): DomainError | null {
  const computedTotal = itemsTotal.add(cmd.deliveryFee)
  if (!computedTotal.equals(cmd.totalAmount)) {
    return new OrderTotalMismatchError({
      orderId: cmd.id,
      expectedTotalDiram: cmd.totalAmount.diram.toString(),
      computedTotalDiram: computedTotal.diram.toString(),
    })
  }
  return null
}

/** SRS-DOM-004 — Rx-позиция без `prescriptionId` запрещена. */
export function validatePrescriptionCoverage(cmd: OrderCreateCommand): DomainError | null {
  const hasRxItem = cmd.items.some((item) => item.isPrescriptionRequired)
  if (hasRxItem && cmd.prescriptionId === null) {
    return new PrescriptionNotVerifiedError({ orderId: cmd.id, reason: 'prescription_id_missing' })
  }
  return null
}

/** SRS-DOM-005/D-08 — психотропные/наркотические позиции никогда не попадают в заказ. */
export function validateNoControlledSubstances(cmd: OrderCreateCommand): DomainError | null {
  const controlled = cmd.items.find((item) => CONTROLLED_CATEGORIES.has(item.controlCategory))
  if (controlled !== undefined) {
    return new ControlledSubstanceNotOrderableError({
      orderId: cmd.id,
      medicineId: controlled.medicineId,
      controlCategory: controlled.controlCategory,
    })
  }
  return null
}

/** SRS-DOM-007/156, D-16 — COD запрещён при Rx-позиции ИЛИ сумме сверх лимита тенанта. */
export function validateCodEligibility(cmd: OrderCreateCommand): DomainError | null {
  if (cmd.paymentMethod !== 'cash_courier') {
    return null
  }
  const hasRxItem = cmd.items.some((item) => item.isPrescriptionRequired)
  if (hasRxItem) {
    return new CodForbiddenForRxError({ orderId: cmd.id })
  }
  if (cmd.totalAmount.diram > cmd.codLimitDiram) {
    return new CodLimitExceededError({
      orderId: cmd.id,
      totalDiram: cmd.totalAmount.diram.toString(),
      codLimitDiram: cmd.codLimitDiram.toString(),
    })
  }
  return null
}

/** SRS-DOM-012 — аптека обязана быть активна на момент создания заказа. */
export function validatePharmacyActive(cmd: OrderCreateCommand): DomainError | null {
  if (!cmd.isPharmacyActiveAtCreation) {
    return new PharmacySuspendedError({ pharmacyId: cmd.pharmacyId })
  }
  return null
}
