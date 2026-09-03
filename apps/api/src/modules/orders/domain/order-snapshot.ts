/**
 * `OrderSnapshot` (EP-09, DTJ-221, доработка DTJ-228 — `billingStrategy`). Вынесена из
 * `order.entity.ts` отдельным файлом ради `C2` (≤300 строк/файл,
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §6) — тот же приём, что вынос `OrderCreateCommand`
 * (`order-create-command.ts`) / валидаторов (`order-create.validators.ts`) из того же файла.
 *
 * Полный plain-снимок состояния `Order` — вход `Order.restore()`/`OrderItem` мапперов, выход
 * `Order.toSnapshot()`. Единственное место прямого чтения приватных полей агрегата извне
 * класса (`order.entity.ts` JSDoc).
 */
import type { BillingStrategy, OrderPaymentMethod, OrderStatus } from '@dorutj/contracts'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import type { OrderItemSnapshot } from './order-item.entity.js'
import type { OrderCancelReason } from './order-domain-event.js'

export interface OrderSnapshot {
  readonly id: string
  readonly orderNumber: OrderNumber
  readonly tenantId: string
  readonly customerId: string
  readonly pharmacyId: string
  readonly items: readonly OrderItemSnapshot[]
  readonly itemsTotal: Money
  readonly deliveryFee: Money
  readonly totalAmount: Money
  readonly deliveryAddress: string
  readonly deliveryLandmark: string | null
  readonly deliveryGeoPoint: GeoPoint | null
  readonly paymentMethod: OrderPaymentMethod
  /** DTJ-228 — снэпшот `ResolveBillingStrategyService.resolve()` на момент checkout. */
  readonly billingStrategy: BillingStrategy
  readonly prescriptionId: string | null
  readonly checkoutAttemptId: string
  readonly status: OrderStatus
  readonly paymentTransactionId: string | null
  readonly cancelReason: OrderCancelReason | null
  readonly cancelledBy: string | null
  readonly slaDeadlineAt: Date | null
  readonly processingStartedAt: Date | null
  readonly pickedUpAt: Date | null
  readonly deliveredAt: Date | null
  readonly handoverOtpId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}
