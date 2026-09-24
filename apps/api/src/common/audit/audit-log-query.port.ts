// Read-only порт, отдельный от write-only AuditLogPort — иначе любой писатель в журнал мог бы
// читать его, чтобы проверять «уже залогировано ли», а это противоречит append-only смыслу журнала.

export const AUDIT_LOG_QUERY_PORT = Symbol.for('@dorutj/common/audit-log-query-port')

export interface AuditLogEntryView {
  readonly id: string
  readonly category: string
  readonly entityType: string
  readonly entityId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly reason: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly requestId: string | null
  readonly tenantId: string | null
  readonly createdAt: Date
}

export interface AuditLogListCursor {
  readonly v: string
  readonly id: string
}

// Поля комбинируются через AND, не взаимоисключающие.
export interface AuditLogFilter {
  readonly category?: string
  readonly entityType?: string
  readonly entityId?: string
  readonly actorUserId?: string
  readonly tenantId?: string
  readonly createdAtFrom?: Date
  readonly createdAtTo?: Date
}

export interface AuditLogListQuery {
  readonly filter: AuditLogFilter
  readonly limit: number
  readonly cursor?: AuditLogListCursor | null
}

export interface AuditLogListPage {
  readonly items: readonly AuditLogEntryView[]
  readonly nextCursor: AuditLogListCursor | null
  readonly hasMore: boolean
}

export interface AuditLogQueryPort {
  findByFilters(query: AuditLogListQuery): Promise<AuditLogListPage>
}
