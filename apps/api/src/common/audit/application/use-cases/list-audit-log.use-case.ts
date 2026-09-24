import { Inject, Injectable } from '@nestjs/common'
import {
  AUDIT_LOG_QUERY_PORT,
  type AuditLogFilter,
  type AuditLogListCursor,
  type AuditLogListPage,
  type AuditLogQueryPort,
} from '../../audit-log-query.port.js'

export interface ListAuditLogCommand {
  readonly filter: AuditLogFilter
  readonly limit: number
  readonly cursor?: AuditLogListCursor | null
}

@Injectable()
export class ListAuditLogUseCase {
  public constructor(@Inject(AUDIT_LOG_QUERY_PORT) private readonly auditLogQuery: AuditLogQueryPort) {}

  public async execute(command: ListAuditLogCommand): Promise<AuditLogListPage> {
    return this.auditLogQuery.findByFilters({ filter: command.filter, limit: command.limit, cursor: command.cursor ?? null })
  }
}
