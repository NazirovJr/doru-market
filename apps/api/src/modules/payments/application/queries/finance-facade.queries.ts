// DTJ-357 — read-методы PaymentsFacade, вынесены из payments.module.ts отдельным файлом (C2, max-lines 300).
import { ValidationError } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import type { PayoutScheduleRepository } from '../ports/payout-schedule-repository.port.js'
import type { EscrowLedgerEntryDto, FinancePage, FinancePagination, FindPayoutScheduleFilter, PayoutScheduleEntryDto } from '../ports/payments-facade.port.js'

/** `orderId` обязателен — платформенный дамп ЦЕЛОГО ledger вне периметра тикета/AC. Без пагинации — леджер заказа ограничен по размеру. */
export async function findEscrowLedgerEntries(repo: EscrowLedgerRepository, orderId: string | undefined): Promise<readonly EscrowLedgerEntryDto[]> {
  if (orderId === undefined) {
    throw new ValidationError('findEscrowLedgerEntries requires orderId')
  }
  const records = await repo.findByOrderId(null, orderId)
  return records.map((record) => ({
    orderId: record.entry.orderId,
    entryType: record.entry.entryType,
    direction: record.entry.direction,
    amountDiram: Number(record.entry.amountDiram.diram),
    reason: record.entry.reason,
    actorUserId: record.entry.actorUserId,
    paymentTransactionRef: record.entry.paymentTransactionRef,
    createdAt: record.createdAt,
  }))
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
