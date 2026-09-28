/**
 * DI-токен `PAYMENTS_FACADE_PORT` (DTJ-350, EP-15) — сужение `PaymentsFacade`
 * (`@/modules/payments`, `PAYMENTS_FACADE`) до методов, реально нужных use case'ам `admin`
 * (Interface Segregation, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3). Прямой импорт
 * `modules/payments/domain|application|infrastructure/*` запрещён (§1.1/§1.2, `pnpm arch:check`).
 *
 * Тот же приём отложенной типизации, что `onboarding-facade.port.ts` (см. его JSDoc).
 * `PAYMENTS_FACADE` уже забинжен в `payments.module.ts` (DTJ-249, `HoldPayoutUseCase` через
 * `useFactory`), но НЕ был в `exports:` этого модуля — добавлено ОДНОЙ строкой этим тикетом
 * (гостевая правка, правомочна по риску DTJ-350 «добавить метод/строку в чужой публичный
 * index.ts, если недостаёт для DI-видимости — но не реализовывать логику чужого модуля»).
 *
 * // заполняется тикетами DTJ-351..367
 */
export const PAYMENTS_FACADE_PORT = Symbol.for('@dorutj/admin/payments-facade-port')

// DTJ-357 — 2 read-метода, зеркало PaymentsFacade. Reconciliation-alerts НЕ здесь — тот use case читает AUDIT_LOG_QUERY_PORT (common/audit) напрямую.
export interface FinanceCursor {
  readonly v: string
  readonly id: string
}

export interface FinancePage<T> {
  readonly items: readonly T[]
  readonly nextCursor: FinanceCursor | null
  readonly hasMore: boolean
}

export interface FinancePagination {
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

export interface EscrowLedgerEntryView {
  readonly orderId: string
  readonly entryType: string
  readonly direction: string
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly paymentTransactionRef: string | null
  readonly createdAt: Date
}

export interface PayoutScheduleEntryView {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly grossAmountDiram: number
  readonly commissionDiram: number
  readonly netAmountDiram: number
  readonly status: string
  readonly dueAt: Date | null
  readonly paidAt: Date | null
}

// Зеркало реального PaymentsFacade.refundFull/adminPaymentOverride (useExisting: PAYMENTS_FACADE).
export interface AdminRefundFullCommand {
  readonly orderId: string
  readonly reason: string
}

export interface AdminPaymentOverrideCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly txId: string
  readonly amountDiram: bigint
  readonly paidAt: Date
  readonly reason: string
  readonly actorUserId: string
  readonly actorRole: string
}

export interface PaymentsFacadePort {
  /** Без пагинации — леджер одного заказа ограничен по размеру (DTJ-357 review). */
  findEscrowLedgerEntries(orderId: string): Promise<readonly EscrowLedgerEntryView[]>
  findPayoutSchedule(
    filter: { readonly status?: string | undefined; readonly pharmacyId?: string | undefined },
    pagination: FinancePagination,
  ): Promise<FinancePage<PayoutScheduleEntryView>>

  // null для cash_courier.
  findPayoutScheduleByOrder(orderId: string): Promise<PayoutScheduleEntryView | null>

  // Полный рефанд при force-cancel оплаченного заказа (RefundOrderUseCase, идемпотентен).
  refundFull(tenantId: string, command: AdminRefundFullCommand): Promise<void>

  // Делегация в уже существующий payments/AdminPaymentOverrideUseCase — не второй домен-путь.
  adminPaymentOverride(command: AdminPaymentOverrideCommand): Promise<void>
}
