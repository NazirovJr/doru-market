import { Inject, Injectable } from '@nestjs/common'
import { AUDIT_LOG_QUERY_PORT, type AuditLogEntryView, type AuditLogListCursor, type AuditLogQueryPort } from '@/common/audit/audit-log-query.port.js'

const LEDGER_ADJUSTMENT_CATEGORY = 'ledger_adjustment'
const ESCROW_LEDGER_ENTITY_TYPE = 'escrow_ledger'

export interface ListReconciliationAlertsQuery {
  readonly limit: number
  readonly cursor: AuditLogListCursor | null
}

export interface ReconciliationAlertView {
  readonly orderId: string
  readonly tenantId: string | null
  readonly discrepancyDiram: number
  readonly repeatDetectionCount: number
  readonly detectedAt: Date
}

export interface ReconciliationAlertsPage {
  readonly items: readonly ReconciliationAlertView[]
  readonly nextCursor: AuditLogListCursor | null
  readonly hasMore: boolean
}

// SRS-ADM-034 — журнал алертов EscrowReconciliationJob, НЕ дедуплицированный (повторные обнаружения — отдельные строки, новые сверху).
@Injectable()
export class ListReconciliationAlertsUseCase {
  public constructor(@Inject(AUDIT_LOG_QUERY_PORT) private readonly auditLogQuery: AuditLogQueryPort) {}

  public async execute(query: ListReconciliationAlertsQuery): Promise<ReconciliationAlertsPage> {
    const page = await this.auditLogQuery.findByFilters({
      filter: { category: LEDGER_ADJUSTMENT_CATEGORY, entityType: ESCROW_LEDGER_ENTITY_TYPE },
      limit: query.limit,
      cursor: query.cursor,
    })
    return { items: page.items.map(toAlertView), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

function toAlertView(entry: AuditLogEntryView): ReconciliationAlertView {
  const discrepancyDiram = entry.metadata.discrepancyDiram
  const repeatDetectionCount = entry.metadata.repeatDetectionCount
  return {
    orderId: entry.entityId,
    tenantId: entry.tenantId,
    discrepancyDiram: typeof discrepancyDiram === 'string' ? Number(discrepancyDiram) : 0,
    repeatDetectionCount: typeof repeatDetectionCount === 'number' ? repeatDetectionCount : 0,
    detectedAt: entry.createdAt,
  }
}
