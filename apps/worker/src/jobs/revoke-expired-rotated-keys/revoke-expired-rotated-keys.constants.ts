export const REVOKE_EXPIRED_ROTATED_KEYS_QUEUE = 'revoke-expired-rotated-keys'
export const REVOKE_EXPIRED_ROTATED_KEYS_JOB_NAME = 'revoke-expired-rotated-keys-tick'
export const REVOKE_EXPIRED_ROTATED_KEYS_SCHEDULER_ID = 'revoke-expired-rotated-keys-periodic'
export const REVOKE_EXPIRED_ROTATED_KEYS_TZ = 'Asia/Dushanbe'

export const REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN = Symbol('REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN')
// Отдельный от бизнес-пулов apps/api — джоба выполняет ТОЛЬКО SELECT (тот же приём, что UNPAID_ORDER_TIMEOUT_DB_POOL).
export const REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL = Symbol('REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL')
export const REVOKE_EXPIRED_ROTATED_KEYS_CRON = Symbol('REVOKE_EXPIRED_ROTATED_KEYS_CRON')
