/**
 * `PaymentsFacade` (EP-10, DTJ-249, SRS-DOM-103/058/105, SRS-PAY-030/032) — публичный контракт
 * модуля `payments` для ВНЕШНИХ модулей (D-27, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2).
 *
 * Токен `PAYMENTS_FACADE` объявлен `modules/payments/index.ts` (DTJ-236, заранее — интерфейс
 * появился ТОЛЬКО сейчас, первым реальным методом). Этот файл — ЕДИНСТВЕННОЕ место, где живёт
 * ФОРМА интерфейса (тот же приём, что `orders-facade.port.ts`/`tenancy-facade.port.ts`: порт
 * объявляется в `application/ports/`, `index.ts` лишь ре-экспортирует тип для внешних
 * потребителей — прямой импорт `modules/payments/application/*` извне блокирует
 * `dependency-cruiser` `no-cross-module-deep-import`).
 *
 * `holdPayout` — единственный метод на сегодня. Первый реальный потребитель — EP-14 (споры,
 * волна 10 на момент EP-10), ещё не начат НА ЭТОЙ ветке (см. «Риски» тикета DTJ-249: сигнатура
 * фиксируется как лучшее понимание на момент EP-10, EP-14 может потребовать координацию/
 * breaking-правку при интеграции). `tenantId` — первый параметр, тот же приём defense-in-depth,
 * что КАЖДЫЙ другой межмодульный порт этого модуля (`PaymentsOrdersPort`/`PaymentsTenancyPort`/
 * `PayoutScheduleRepository.reverseIfExists`, правило 3 задания, SRS-API-043/046) — буквальный
 * текст «Технический контекст» тикета называет только `(orderId, disputeId)`, добавление
 * `tenantId` — осознанное расширение ради консистентности модуля, зафиксировано явно (отчёт
 * сдачи DTJ-249).
 */

/** Результат `holdPayout` (SRS-DOM-105/SRS-DISP-002) — см. JSDoc `HoldPayoutUseCase`. */
export interface HoldPayoutResult {
  /** `true` — `payout_schedule` УЖЕ вне `('pending','due')` (типично `paid`, AC3 DTJ-249) —
   * вызывающий код (EP-14) решает дальнейшую логику (`requires_adjustment` и т.п.), сам факт
   * НЕ является ошибкой этого вызова. */
  readonly alreadyPaid: boolean
}

export interface RefundOrderFullCommand {
  readonly orderId: string
  readonly reason: string
}

export interface RecordLedgerAdjustmentCommand {
  readonly orderId: string
  readonly amountDiram: bigint
  readonly reason: string
  readonly actorUserId: string
}

// DTJ-357 — 2 read-метода для admin (PAYMENTS_FACADE_PORT), @Roles('super_admin')-only.
export interface FinanceCursor {
  readonly v: string
  readonly id: string
}

export interface FinancePage<T> {
  readonly items: readonly T[]
  readonly nextCursor: FinanceCursor | null
  readonly hasMore: boolean
}

export interface EscrowLedgerEntryDto {
  readonly orderId: string
  readonly entryType: string
  readonly direction: string
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly paymentTransactionRef: string | null
  readonly createdAt: Date
}

export interface PayoutScheduleEntryDto {
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

export interface FindPayoutScheduleFilter {
  readonly status?: string | undefined
  readonly pharmacyId?: string | undefined
}

export interface FinancePagination {
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

export interface BillingInvoiceDto {
  readonly id: string
  readonly chainId: string
  readonly invoiceType: string
  readonly status: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly subtotalDiram: number
  readonly vatDiram: number
  readonly totalDiram: number
  readonly issuedAt: Date | null
  readonly dueAt: Date | null
  readonly paidAt: Date | null
}

export interface FindBillingInvoicesFilter {
  readonly chainId?: string | undefined
  readonly invoiceType?: string | undefined
  readonly status?: string | undefined
}

export type MarkInvoicePaidResult = 'paid' | 'already_paid' | 'not_found' | 'invalid_status'

export interface PaymentsFacade {
  /**
   * Атомарно переводит `payout_schedule` заказа в `status='disputed'` (SRS-DOM-058), если она
   * сейчас `'pending'`/`'due'`. НЕ бросает, если выплата уже вне этих статусов — возвращает
   * `{ alreadyPaid: true }` (см. `HoldPayoutResult`).
   */
  holdPayout(tenantId: string, orderId: string, disputeId: string): Promise<HoldPayoutResult>

  /** Полный возврат без отмены заказа — тонкая обёртка над `RefundOrderUseCase`, идемпотентна. */
  refundFull(tenantId: string, command: RefundOrderFullCommand): Promise<void>

  /** Учётная корректировка ledger, `direction` всегда `'credit'` — тонкая обёртка над `AdjustLedgerUseCase`. */
  recordAdjustment(command: RecordLedgerAdjustmentCommand): Promise<void>

  /** Леджер одного заказа ограничен по размеру (DTJ-357 review) — без пагинации, все записи разом. */
  findEscrowLedgerEntries(orderId: string): Promise<readonly EscrowLedgerEntryDto[]>

  findPayoutSchedule(filter: FindPayoutScheduleFilter, pagination: FinancePagination): Promise<FinancePage<PayoutScheduleEntryDto>>

  // null для cash_courier/ещё не доставленного заказа.
  findPayoutScheduleByOrder(orderId: string): Promise<PayoutScheduleEntryDto | null>

  listBillingInvoices(filter: FindBillingInvoicesFilter, pagination: FinancePagination): Promise<FinancePage<BillingInvoiceDto>>
  getBillingInvoiceById(invoiceId: string): Promise<BillingInvoiceDto | null>
  markInvoicePaid(invoiceId: string, tx?: unknown): Promise<MarkInvoicePaidResult>
}
