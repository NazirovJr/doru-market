// DTJ-357 — read-методы PaymentsFacade, вынесены из payments.module.ts отдельным файлом (C2, max-lines 300).
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import type { PayoutScheduleRepository } from '../ports/payout-schedule-repository.port.js'
import type { BillingInvoiceReportRow, PlatformBillingInvoiceRepository } from '../ports/platform-billing-invoice-repository.port.js'
// DTJ-358 — commission-rates CRUD (platform_fee), добавлено этим же файлом (тот же приём, что read-методы выше).
import type { CommissionRateRepository, CommissionRateRow } from '../ports/commission-rate-repository.port.js'
import type {
  BillingInvoiceDto,
  CommissionRateDto,
  EscrowLedgerEntryDto,
  FinancePage,
  FinancePagination,
  FindBillingInvoicesFilter,
  FindCommissionRatesFilter,
  FindPayoutScheduleFilter,
  PayoutScheduleEntryDto,
  UpsertCommissionRateCommand,
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

function toCommissionRateDto(row: CommissionRateRow): CommissionRateDto {
  return { ...row }
}

export async function listCommissionRates(
  repo: CommissionRateRepository,
  filter: FindCommissionRatesFilter,
  pagination: FinancePagination,
): Promise<FinancePage<CommissionRateDto>> {
  const page = await repo.findMany({ ...filter, limit: pagination.limit, cursor: pagination.cursor })
  return { items: page.items.map(toCommissionRateDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
}

/** `command.id` задан → `UPDATE`, `null` от репозитория → `NotFoundError` (строка исчезла между чтением списка и сохранением формы). */
export async function upsertCommissionRate(repo: CommissionRateRepository, command: UpsertCommissionRateCommand): Promise<CommissionRateDto> {
  const fields = {
    tenantId: command.tenantId,
    chainId: command.chainId,
    category: command.category,
    rateBps: command.rateBps,
    effectiveFrom: command.effectiveFrom,
    effectiveTo: command.effectiveTo,
    createdBy: command.actorUserId,
  }
  if (command.id === undefined) {
    return toCommissionRateDto(await repo.insert(fields))
  }
  const updated = await repo.update({ id: command.id, ...fields })
  if (updated === null) {
    throw new NotFoundError({ resource: 'commission_rate', id: command.id })
  }
  return toCommissionRateDto(updated)
}

export interface ResolveCommissionRateQuery {
  readonly tenantId: string
  readonly chainId: string | null
  readonly category: string
}

export async function resolveCommissionRate(repo: CommissionRateRepository, clock: Clock, query: ResolveCommissionRateQuery): Promise<number | null> {
  return repo.resolveActiveRate({ ...query, now: clock.now() })
}
