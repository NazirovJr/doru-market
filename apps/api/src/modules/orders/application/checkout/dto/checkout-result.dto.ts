/**
 * `CheckoutResultDto` (EP-09, DTJ-227, «Что сделать» п.2 шаг 5) — выход `CheckoutUseCase.execute()`.
 * Композитный ответ с частичным успехом (SRS-ORD-019/020): одни аптеки оформились, другие —
 * нет, presentation-слой (DTJ-233) отдаёт это ОДНИМ `200`/`201`, не роняет весь запрос.
 */
import type { OrderStatus } from '@dorutj/contracts'

export interface CheckoutOrderResultDto {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly status: OrderStatus
  readonly totalAmountDiram: number
  /**
   * `true` — non-cash заказ создан (СТАТУС `pending_payment` УЖЕ ЗАКОММИЧЕН), но
   * `PaymentInvoicePort.createInvoice` не вернул успех (таймаут/ошибка провайдера, D-EP09-17).
   * Заказ НЕ откатывается. Presentation-слой (DTJ-233): если это ЕДИНСТВЕННАЯ группа ответа —
   * транслирует в `503 PAYMENT_PROVIDER_UNAVAILABLE`; при нескольких группах — остальные не
   * затронуты, этот флаг — единственный сигнал клиенту про конкретный заказ.
   */
  readonly paymentPending: boolean
}

export interface CheckoutFailedGroupDto {
  readonly pharmacyId: string
  /** `ErrorCode` провалившей заказ группы ошибки (например `INSUFFICIENT_STOCK`, `ORDER_TOTAL_MISMATCH`). */
  readonly reason: string
  // `| undefined` явно (не только `?:`) — `tsconfig.json` держит `exactOptionalPropertyTypes:
  // true`, `DomainError.details` тоже опционален и может прийти `undefined`.
  readonly details?: Record<string, unknown> | undefined
}

export interface CheckoutExcludedItemDto {
  readonly cartItemId: string
  /** Например `PHARMACY_SUSPENDED` (SRS-ORD-041) — единая точка проверки с обычной приостановкой. */
  readonly reason: string
}

export interface CheckoutResultDto {
  readonly orders: readonly CheckoutOrderResultDto[]
  readonly failedGroups: readonly CheckoutFailedGroupDto[]
  readonly meta: {
    readonly excludedItems: readonly CheckoutExcludedItemDto[]
  }
}
