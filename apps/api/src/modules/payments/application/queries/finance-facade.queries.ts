// DTJ-357 — read-методы PaymentsFacade, вынесены из payments.module.ts отдельным файлом (C2, max-lines 300).
import { ValidationError } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import type { PayoutScheduleRepository } from '../ports/payout-schedule-repository.port.js'
import type { BillingInvoiceReportRow, PlatformBillingInvoiceRepository } from '../ports/platform-billing-invoice-repository.port.js'
import type {
  BillingInvoiceDto,
  EscrowLedgerEntryDto,
  FinancePage,
  FinancePagination,
  FindBillingInvoicesFilter,
  FindPayoutScheduleFilter,
  PayoutScheduleEntryDto,
} from '../ports/payments-facade.port.js'

// null для cash_courier — строки нет вовсе, не пустой результат.
export async function findPayoutScheduleByOrder(repo: PayoutScheduleRepository, orderId: string): Promise<PayoutScheduleEntryDto | null> {
  const row = await repo.findByOrderId(orderId)
  if (row === null) {
    return null
  }
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    pharmacyId: row.pharmacyId,
    grossAmountDiram: Number(row.grossAmountDiram),
    commissionDiram: Number(row.commissionDiram),
    netAmountDiram: Number(row.netAmountDiram),
    status: row.status,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  }
}

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

export async function listBillingInvoices(
  repo: PlatformBillingInvoiceRepository,
  filter: FindBillingInvoicesFilter,
  pagination: FinancePagination,
): Promise<FinancePage<BillingInvoiceDto>> {
  const page = await repo.findAll({ filter, limit: pagination.limit, cursor: pagination.cursor })
  return { items: page.items.map(toBillingInvoiceDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
}

export function toBillingInvoiceDto(row: BillingInvoiceReportRow): BillingInvoiceDto {
  return {
    id: row.id,
    chainId: row.chainId,
    invoiceType: row.invoiceType,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    subtotalDiram: Number(row.subtotalDiram),
    vatDiram: Number(row.vatDiram),
    totalDiram: Number(row.totalDiram),
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  }
}
