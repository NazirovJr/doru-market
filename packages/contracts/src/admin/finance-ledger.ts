// DTJ-357 — три READ-ONLY экрана финансов. filter[...] — bracket-синтаксис (тот же приём, что PharmacyAccountsAdminController, DTJ-073).
export const PAYOUT_SCHEDULE_STATUS_VALUES = ['pending', 'due', 'disputed', 'paid', 'reversed'] as const
export type PayoutScheduleStatus = (typeof PAYOUT_SCHEDULE_STATUS_VALUES)[number]

// Префикс Finance* — избегает коллизии с неиспользуемыми заготовками payments.ts (DTJ-236, другая форма полей).
export interface FinanceEscrowLedgerEntryDto {
  readonly orderId: string
  readonly entryType: string
  readonly direction: string
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly paymentTransactionRef: string | null
  readonly createdAt: string
}

export interface FinancePayoutScheduleEntryDto {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly grossAmountDiram: number
  readonly commissionDiram: number
  readonly netAmountDiram: number
  readonly status: string
  readonly dueAt: string | null
  readonly paidAt: string | null
}

export interface FinanceReconciliationAlertDto {
  readonly orderId: string
  readonly tenantId: string | null
  readonly discrepancyDiram: number
  readonly repeatDetectionCount: number
  readonly detectedAt: string
}
