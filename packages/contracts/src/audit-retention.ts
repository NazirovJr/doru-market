// Общий источник для apps/api и apps/worker (worker не импортирует apps/api).
import { AUDIT_LOG_CATEGORY_VALUES, type AuditLogCategory } from './admin/audit-log.js'

export const AUDIT_LOG_RETENTION_YEARS_DEFAULT = 5
export const AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY: AuditLogCategory = 'prescription_access'

if (!(AUDIT_LOG_CATEGORY_VALUES as readonly string[]).includes(AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY)) {
  throw new Error('audit-retention: AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY не входит в AUDIT_LOG_CATEGORY_VALUES')
}
