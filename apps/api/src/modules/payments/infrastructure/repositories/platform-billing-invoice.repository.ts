/**
 * `DrizzlePlatformBillingInvoiceRepository` (EP-10, DTJ-251) — реализация
 * `PlatformBillingInvoiceRepository` поверх `platform_billing_invoices` (`db/schema/
 * payments.ts`, миграция `0038_platform_billing_invoices.sql`). См. JSDoc порта: НЕ
 * потребляется `apps/worker` (своя раздельная реализация там), задел для DTJ-252.
 *
 * `upsertDraft` — один `INSERT ... ON CONFLICT (chain_id, invoice_type, period_start) DO
 * UPDATE` (уникальность из миграции DTJ-251), не check-then-write: `subtotal_diram`/
 * `total_diram` инкрементируются ссылкой на ТЕКУЩЕЕ значение строки внутри самого UPDATE
 * (`sql` фрагмент), атомарно на уровне БД — конкурентные вызовы для одного `(chain,period)` не
 * теряют инкременты друг друга.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { platformBillingInvoices } from '@/db/schema/payments.js'
import {
  PLATFORM_BILLING_INVOICE_REPOSITORY,
  type BillingInvoiceReportRow,
  type FindAllInvoicesInput,
  type FindInvoicesByChainInput,
  type FindInvoicesByChainResult,
  type IssueInvoiceInput,
  type MarkInvoicePaidOutcome,
  type PlatformBillingInvoiceRepository,
  type PlatformBillingInvoiceRow,
  type UpsertDraftInput,
} from '@/modules/payments/application/ports/platform-billing-invoice-repository.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

/** Единственный `invoice_type`, который знает этот тикет (см. JSDoc порта). */
const CASH_COURIER_COMMISSION_TYPE = 'cash_courier_commission'
const DRAFT_STATUS = 'draft'
const ISSUED_STATUS = 'issued'
const PAID_STATUS = 'paid'
const PAYABLE_STATUSES = ['issued', 'overdue'] as const
const ZERO_DIRAM = 0n

@Injectable()
export class DrizzlePlatformBillingInvoiceRepository implements PlatformBillingInvoiceRepository {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findDraftForPeriod(chainId: string, periodStart: Date): Promise<PlatformBillingInvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(platformBillingInvoices)
      .where(
        and(
          eq(platformBillingInvoices.chainId, chainId),
          eq(platformBillingInvoices.invoiceType, CASH_COURIER_COMMISSION_TYPE),
          eq(platformBillingInvoices.status, DRAFT_STATUS),
          eq(platformBillingInvoices.periodStart, periodStart),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : toRow(row)
  }

  public async upsertDraft(input: UpsertDraftInput): Promise<void> {
    await this.db
      .insert(platformBillingInvoices)
      .values({
        chainId: input.chainId,
        invoiceType: CASH_COURIER_COMMISSION_TYPE,
        status: DRAFT_STATUS,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        subtotalDiram: input.additionalSubtotalDiram,
        vatDiram: ZERO_DIRAM,
        totalDiram: input.additionalSubtotalDiram,
      })
      .onConflictDoUpdate({
        target: [platformBillingInvoices.chainId, platformBillingInvoices.invoiceType, platformBillingInvoices.periodStart],
        set: {
          subtotalDiram: sql`${platformBillingInvoices.subtotalDiram} + ${input.additionalSubtotalDiram}`,
          totalDiram: sql`${platformBillingInvoices.totalDiram} + ${input.additionalSubtotalDiram}`,
        },
      })
  }

  public async issue(input: IssueInvoiceInput): Promise<void> {
    await this.db
      .update(platformBillingInvoices)
      .set({
        status: ISSUED_STATUS,
        issuedAt: input.issuedAt,
        dueAt: input.dueAt,
        vatDiram: input.vatDiram,
        totalDiram: input.totalDiram,
      })
      .where(and(eq(platformBillingInvoices.id, input.invoiceId), eq(platformBillingInvoices.status, DRAFT_STATUS)))
  }

  /** (DTJ-252) — см. JSDoc порта. `LIMIT input.limit + 1` — `hasMore` без второй `COUNT`-круговой поездки (тот же приём, что `PayoutScheduleRepository.findByPharmacy`). */
  public async findByChain(input: FindInvoicesByChainInput): Promise<FindInvoicesByChainResult> {
    const conditions = [eq(platformBillingInvoices.chainId, input.chainId)]
    if (input.cursor !== null) {
      const cursorCreatedAtValue = new Date(input.cursor.v)
      const keysetCondition = or(
        lt(platformBillingInvoices.createdAt, cursorCreatedAtValue),
        and(eq(platformBillingInvoices.createdAt, cursorCreatedAtValue), lt(platformBillingInvoices.id, input.cursor.id)),
      )
      if (keysetCondition !== undefined) {
        conditions.push(keysetCondition)
      }
    }
    const rows = await this.db
      .select()
      .from(platformBillingInvoices)
      .where(and(...conditions))
      .orderBy(desc(platformBillingInvoices.createdAt), desc(platformBillingInvoices.id))
      .limit(input.limit + 1)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toBillingInvoiceReportRow),
      nextCursor: hasMore && last !== undefined ? { v: (last.createdAt ?? new Date(0)).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  public async findAll(input: FindAllInvoicesInput): Promise<FindInvoicesByChainResult> {
    const conditions = buildFindAllConditions(input)
    const rows = await this.db
      .select()
      .from(platformBillingInvoices)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(platformBillingInvoices.createdAt), desc(platformBillingInvoices.id))
      .limit(input.limit + 1)
    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toBillingInvoiceReportRow),
      nextCursor: hasMore && last !== undefined ? { v: (last.createdAt ?? new Date(0)).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  public async findById(invoiceId: string): Promise<BillingInvoiceReportRow | null> {
    const rows = await this.db.select().from(platformBillingInvoices).where(eq(platformBillingInvoices.id, invoiceId)).limit(1)
    const row = rows[0]
    return row === undefined ? null : toBillingInvoiceReportRow(row)
  }

  public async markPaid(invoiceId: string, tx?: unknown): Promise<MarkInvoicePaidOutcome> {
    const client = resolveDrizzleClient(this.db, tx)
    const updated = await client
      .update(platformBillingInvoices)
      .set({ status: PAID_STATUS, paidAt: sql`NOW()` })
      .where(and(eq(platformBillingInvoices.id, invoiceId), inArray(platformBillingInvoices.status, PAYABLE_STATUSES)))
      .returning({ id: platformBillingInvoices.id })
    if (updated.length > 0) {
      return 'paid'
    }
    const existing = await this.findById(invoiceId)
    if (existing === null) return 'not_found'
    if (existing.status === PAID_STATUS) return 'already_paid'
    return 'invalid_status'
  }
}

// sql-фрагмент, не eq(): колонки — строгие pgEnum, а filter.invoiceType/status — generic string.
function buildFindAllConditions(input: FindAllInvoicesInput): SQL[] {
  const conditions: SQL[] = []
  if (input.filter.chainId !== undefined) conditions.push(eq(platformBillingInvoices.chainId, input.filter.chainId))
  if (input.filter.invoiceType !== undefined) conditions.push(sql`${platformBillingInvoices.invoiceType} = ${input.filter.invoiceType}`)
  if (input.filter.status !== undefined) conditions.push(sql`${platformBillingInvoices.status} = ${input.filter.status}`)
  if (input.cursor !== null) {
    const cursorCreatedAtValue = new Date(input.cursor.v)
    const keysetCondition = or(
      lt(platformBillingInvoices.createdAt, cursorCreatedAtValue),
      and(eq(platformBillingInvoices.createdAt, cursorCreatedAtValue), lt(platformBillingInvoices.id, input.cursor.id)),
    )
    if (keysetCondition !== undefined) conditions.push(keysetCondition)
  }
  return conditions
}

function toBillingInvoiceReportRow(row: typeof platformBillingInvoices.$inferSelect): BillingInvoiceReportRow {
  return {
    id: row.id,
    chainId: row.chainId,
    invoiceType: row.invoiceType,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    subtotalDiram: row.subtotalDiram,
    vatDiram: row.vatDiram,
    totalDiram: row.totalDiram,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  }
}

/** Drizzle `$inferSelect`-строка → доменно-нейтральный `PlatformBillingInvoiceRow` (см. JSDoc порта). */
function toRow(row: typeof platformBillingInvoices.$inferSelect): PlatformBillingInvoiceRow {
  return {
    id: row.id,
    chainId: row.chainId,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    subtotalDiram: row.subtotalDiram,
    vatDiram: row.vatDiram,
    totalDiram: row.totalDiram,
  }
}

export const PLATFORM_BILLING_INVOICE_REPOSITORY_PROVIDER = {
  provide: PLATFORM_BILLING_INVOICE_REPOSITORY,
  useClass: DrizzlePlatformBillingInvoiceRepository,
} as const
