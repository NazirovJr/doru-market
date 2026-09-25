// DTJ-357 — 3 read-метода PaymentsFacade, вынесены из payments.module.ts отдельным файлом (C2, max-lines 300).
import { ValidationError } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import type { PayoutScheduleRepository } from '../ports/payout-schedule-repository.port.js'
import type { AuditLogPort } from '../ports/audit-log.port.js'
import type {
  EscrowLedgerEntryDto,
  FinancePage,
  FinancePagination,
  FindEscrowLedgerFilter,
  FindPayoutScheduleFilter,
  PayoutScheduleEntryDto,
  ReconciliationAlertDto,
} from '../ports/payments-facade.port.js'

/** `filter.orderId` обязателен на практике — платформенный дамп ЦЕЛОГО ledger вне периметра тикета/AC. */
export async function findEscrowLedgerEntries(
  repo: EscrowLedgerRepository,
  filter: FindEscrowLedgerFilter,
  pagination: FinancePagination,
): Promise<FinancePage<EscrowLedgerEntryDto>> {
  if (filter.orderId === undefined) {
    throw new ValidationError('findEscrowLedgerEntries requires filter.orderId')
  }
  const page = await repo.findByOrderPaged({ orderId: filter.orderId, limit: pagination.limit, cursor: pagination.cursor })
  return {
    items: page.items.map((row) => ({
      orderId: row.orderId,
      entryType: row.entryType,
      direction: row.direction,
      amountDiram: Number(row.amountDiram),
      reason: row.reason,
      actorUserId: row.actorUserId,
      paymentTransactionRef: row.paymentTransactionRef,
      createdAt: row.createdAt,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

export async function findPayoutSchedule(
  repo: PayoutScheduleRepository,
  filter: FindPayoutScheduleFilter,
  pagination: FinancePagination,
): Promise<FinancePage<PayoutScheduleEntryDto>> {
  const page = await repo.findSchedule({ status: filter.status, pharmacyId: filter.pharmacyId, limit: pagination.limit, cursor: pagination.cursor })
  return {
    items: page.items.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      pharmacyId: row.pharmacyId,
      grossAmountDiram: Number(row.grossAmountDiram),
      commissionDiram: Number(row.commissionDiram),
      netAmountDiram: Number(row.netAmountDiram),
      status: row.status,
      dueAt: row.dueAt,
      paidAt: row.paidAt,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

export async function findReconciliationAlerts(port: AuditLogPort, pagination: FinancePagination): Promise<FinancePage<ReconciliationAlertDto>> {
  const page = await port.findLedgerAdjustmentAlerts({ limit: pagination.limit, cursor: pagination.cursor })
  return {
    items: page.items.map((row) => ({
      orderId: row.orderId,
      tenantId: row.tenantId,
      discrepancyDiram: Number(row.discrepancyDiram),
      repeatDetectionCount: row.repeatDetectionCount,
      detectedAt: row.detectedAt,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}
