// FinanceLedgerController (SRS-ADM-034) — 3 READ-ONLY эндпоинта, только @Get. filter[...] прочитаны напрямую (тот же приём, что pharmacy-accounts-report-query.util.ts).
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  cursorQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  type CursorQuery,
  type FinanceEscrowLedgerEntryDto,
  type PaginationMeta,
  type FinancePayoutScheduleEntryDto,
  type FinanceReconciliationAlertDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import type { AuditLogListCursor } from '@/common/audit/audit-log-query.port.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import type { EscrowLedgerEntryView, FinanceCursor, PayoutScheduleEntryView } from '../application/ports/payments-facade.port.js'
import { ListEscrowLedgerUseCase } from '../application/use-cases/list-escrow-ledger.use-case.js'
import { ListPayoutScheduleUseCase } from '../application/use-cases/list-payout-schedule.use-case.js'
import { ListReconciliationAlertsUseCase } from '../application/use-cases/list-reconciliation-alerts.use-case.js'
import type { ReconciliationAlertView } from '../application/use-cases/list-reconciliation-alerts.use-case.js'

@Controller({ path: 'finance', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class FinanceLedgerController {
  public constructor(
    @Inject(ListEscrowLedgerUseCase) private readonly listEscrowLedgerUseCase: ListEscrowLedgerUseCase,
    @Inject(ListPayoutScheduleUseCase) private readonly listPayoutScheduleUseCase: ListPayoutScheduleUseCase,
    @Inject(ListReconciliationAlertsUseCase) private readonly listReconciliationAlertsUseCase: ListReconciliationAlertsUseCase,
  ) {}

  @Get('escrow-ledger')
  public async getEscrowLedger(@Query('filter[orderId]') orderId: string | undefined): Promise<SuccessEnvelope<readonly FinanceEscrowLedgerEntryDto[]>> {
    const items = await this.listEscrowLedgerUseCase.execute({ orderId })
    return ok(items.map(toLedgerEntryDto))
  }

  @Get('payout-schedule')
  public async getPayoutSchedule(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
    @Query('filter[status]') status: string | undefined,
    @Query('filter[pharmacyId]') pharmacyId: string | undefined,
  ): Promise<SuccessEnvelope<readonly FinancePayoutScheduleEntryDto[]>> {
    const result = await this.listPayoutScheduleUseCase.execute({ status, pharmacyId, limit: query.limit, cursor: parseFinanceCursor(query.cursor) })
    return ok(result.items.map(toPayoutScheduleDto), { pagination: toPaginationMeta(result, query.limit) })
  }

  @Get('reconciliation-alerts')
  public async getReconciliationAlerts(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<SuccessEnvelope<readonly FinanceReconciliationAlertDto[]>> {
    const result = await this.listReconciliationAlertsUseCase.execute({ limit: query.limit, cursor: parseAuditLogCursor(query.cursor) })
    return ok(result.items.map(toFinanceReconciliationAlertDto), { pagination: toPaginationMeta(result, query.limit) })
  }
}

function parseFinanceCursor(raw: string | undefined): FinanceCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

// AuditLogListCursor — та же форма {v, id}, что FinanceCursor (common/audit, не admin-порт).
function parseAuditLogCursor(raw: string | undefined): AuditLogListCursor | null {
  return parseFinanceCursor(raw)
}

function toPaginationMeta(page: { readonly nextCursor: { readonly v: string; readonly id: string } | null; readonly hasMore: boolean }, limit: number): PaginationMeta {
  return { nextCursor: page.nextCursor === null ? null : encodeCursor(page.nextCursor), hasMore: page.hasMore, limit }
}

function toLedgerEntryDto(view: EscrowLedgerEntryView): FinanceEscrowLedgerEntryDto {
  return { ...view, createdAt: view.createdAt.toISOString() }
}

function toPayoutScheduleDto(view: PayoutScheduleEntryView): FinancePayoutScheduleEntryDto {
  return { ...view, dueAt: view.dueAt?.toISOString() ?? null, paidAt: view.paidAt?.toISOString() ?? null }
}

function toFinanceReconciliationAlertDto(view: ReconciliationAlertView): FinanceReconciliationAlertDto {
  return { ...view, detectedAt: view.detectedAt.toISOString() }
}
