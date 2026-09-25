export const AUDIT_LOG_RETENTION_QUEUE = 'audit-log-retention'
export const AUDIT_LOG_RETENTION_JOB_NAME = 'audit-log-retention-tick'
export const AUDIT_LOG_RETENTION_SCHEDULER_ID = 'audit-log-retention-quarterly'
export const AUDIT_LOG_RETENTION_TZ = 'Asia/Dushanbe'

export const AUDIT_LOG_RETENTION_QUEUE_TOKEN = Symbol('AUDIT_LOG_RETENTION_QUEUE_TOKEN')

// undefined, если AUDIT_RETENTION_DATABASE_URL не задан — см. NullAuditLogRetentionAdapter.
export const AUDIT_LOG_RETENTION_DB_POOL = Symbol('AUDIT_LOG_RETENTION_DB_POOL')

export const AUDIT_LOG_RETENTION_PORT = Symbol('AUDIT_LOG_RETENTION_PORT')
export const AUDIT_LOG_RETENTION_YEARS = Symbol('AUDIT_LOG_RETENTION_YEARS')
export const AUDIT_LOG_RETENTION_BATCH_SIZE = Symbol('AUDIT_LOG_RETENTION_BATCH_SIZE')
export const AUDIT_LOG_RETENTION_CRON = Symbol('AUDIT_LOG_RETENTION_CRON')
