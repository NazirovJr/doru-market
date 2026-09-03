/**
 * Команда `Order.create()` (EP-09, DTJ-221). Вынесена из `order.entity.ts` отдельным файлом
 * ради `C2` (≤300 строк/файл, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §6) — тот же приём, что и
 * вынос `OrderItem` в свой файл (см. JSDoc тикета DTJ-221 «Задача»).
 *
 * Домен принимает уже РЕЗОЛВЛЕННЫЕ значения (не порты) — `isPharmacyActiveAtCreation`,
 * готовый `orderNumber`, `codLimitDiram` — по тому же принципу: `CheckoutUseCase` (DTJ-227)
 * делает вызовы портов ДО `Order.create()`, домен лишь получает результат (`02` §2.6).
 */
import type { BillingStrategy, ControlCategoryPublic, OrderPaymentMethod } from '@dorutj/contracts'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'

/** R1-дефолт лимита COD (SRS-DOM-007, D-16) — используется, когда `tenant_settings.cod_limit_diram`
 * недоступен вызывающему коду (тесты/фикстуры); в проде значение приходит из реальной настройки
 * тенанта (D-EP09-5) — домен НЕ хардкодит его сам, только именует дефолт для потребителей. */
export const COD_LIMIT_DEFAULT_DIRAM = 50_000n

export interface OrderItemCommand {
  readonly id: string
  readonly medicineId: string
  /** Собственный `pharmacyId` позиции — для defensive-проверки SRS-DOM-002 (см. валидаторы). */
  readonly pharmacyId: string
  readonly unitPrice: Money
  readonly quantity: number
  /** Уже резолвлённая ставка комиссии (basis points) — `TenancyFacadePort`, вызван до `create()`. */
  readonly commissionBps: number
  readonly inventoryBatchId: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategoryPublic
}

export interface OrderCreateCommand {
  readonly id: string
  readonly orderNumber: OrderNumber
  readonly tenantId: string
  readonly customerId: string
  readonly pharmacyId: string
  readonly items: readonly OrderItemCommand[]
  readonly deliveryAddress: string
  readonly deliveryLandmark: string | null
  readonly deliveryGeoPoint: GeoPoint | null
  readonly deliveryFee: Money
  /** Ожидаемый итог (SRS-DOM-003) — сверяется с `Σ(item.totalPrice) + deliveryFee`, не источник истины. */
  readonly totalAmount: Money
  readonly paymentMethod: OrderPaymentMethod
  /** `ResolveBillingStrategyService.resolve()` (DTJ-228) — снэпшот, вызван ДО `create()`. */
  readonly billingStrategy: BillingStrategy
  readonly prescriptionId: string | null
  readonly checkoutAttemptId: string
  /** `OnboardingFacadePort.isPharmacyActive(pharmacyId)`, вызван ДО `create()` (SRS-DOM-012). */
  readonly isPharmacyActiveAtCreation: boolean
  /** `tenant_settings.cod_limit_diram` (D-EP09-5) — резолвится вызывающим кодом. */
  readonly codLimitDiram: bigint
  /** `Clock.now()` — домен не вызывает `new Date()` напрямую (`02` §2.6). */
  readonly now: Date
}
