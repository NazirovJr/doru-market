/**
 * Константы джобы `license-expiry-check` (DTJ-073).
 * Таймзона — Asia/Dushanbe (`01-TECH-BASELINE.md`); расписание — ежедневно 06:00.
 */
export const LICENSE_EXPIRY_CHECK_QUEUE = 'license-expiry-check'
export const LICENSE_EXPIRY_CHECK_JOB_NAME = 'license-expiry-check-tick'
export const LICENSE_EXPIRY_CHECK_SCHEDULER_ID = 'license-expiry-check-daily'
export const LICENSE_EXPIRY_CHECK_CRON = '0 6 * * *'
export const LICENSE_EXPIRY_CHECK_TZ = 'Asia/Dushanbe'
export const LICENSE_EXPIRY_BATCH_LIMIT = 200
