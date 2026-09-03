/**
 * `validOrderCreateCommand` (EP-09, DTJ-221) — фабрика валидной `OrderCreateCommand` для
 * unit-тестов `Order.create()`. `testing/` — не `domain/`, `Date`/`randomUUID` разрешены здесь
 * (тот же приём, что `fixed-date.fixture.ts`, `shared-kernel/testing/`).
 */
import { randomUUID } from 'node:crypto'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { COD_LIMIT_DEFAULT_DIRAM, type OrderCreateCommand, type OrderItemCommand } from '@/modules/orders/domain/order-create-command.js'

const DEFAULT_UNIT_PRICE_DIRAM = 10_000n
const DEFAULT_DELIVERY_FEE_DIRAM = 1_500n
const DEFAULT_QUANTITY = 2
const DEFAULT_COMMISSION_BPS = 800

export function validOrderItemCommand(overrides: Partial<OrderItemCommand> = {}): OrderItemCommand {
  return {
    id: randomUUID(),
    medicineId: randomUUID(),
    pharmacyId: overrides.pharmacyId ?? 'pharmacy-1',
    unitPrice: Money.fromDiram(DEFAULT_UNIT_PRICE_DIRAM),
    quantity: DEFAULT_QUANTITY,
    commissionBps: DEFAULT_COMMISSION_BPS,
    inventoryBatchId: randomUUID(),
    isPrescriptionRequired: false,
    controlCategory: 'none',
    ...overrides,
  }
}

/** Один товар, `pharmacyId='pharmacy-1'`, `deliveryFee=1500` — итог собирается из `items`. */
export function validOrderCreateCommand(overrides: Partial<OrderCreateCommand> = {}): OrderCreateCommand {
  const items = overrides.items ?? [validOrderItemCommand()]
  const deliveryFee = overrides.deliveryFee ?? Money.fromDiram(DEFAULT_DELIVERY_FEE_DIRAM)
  const itemsTotal = items.reduce((sum, item) => sum.add(item.unitPrice.multiplyByQuantity(item.quantity)), Money.fromDiram(0n))
  return {
    id: randomUUID(),
    orderNumber: OrderNumber.fromParts('260827', 1),
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    pharmacyId: 'pharmacy-1',
    items,
    deliveryAddress: 'Dushanbe, Rudaki 1',
    deliveryLandmark: null,
    deliveryGeoPoint: geoPointOrThrow(38.5598, 68.787),
    deliveryFee,
    totalAmount: itemsTotal.add(deliveryFee),
    paymentMethod: 'alif_mobi',
    billingStrategy: 'single_invoice',
    prescriptionId: null,
    checkoutAttemptId: randomUUID(),
    isPharmacyActiveAtCreation: true,
    codLimitDiram: COD_LIMIT_DEFAULT_DIRAM,
    now: new Date('2026-08-27T10:00:00.000Z'),
    ...overrides,
  }
}

function geoPointOrThrow(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw new Error('fixture: invalid GeoPoint')
  return result.value
}
