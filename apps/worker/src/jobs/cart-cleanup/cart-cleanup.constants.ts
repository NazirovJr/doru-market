/**
 * Константы и DI-токены джобы `cart-cleanup` (DTJ-224, SRS-ORD-005..009). Таймзона —
 * Asia/Dushanbe (`01-TECH-BASELINE.md`); расписание — ежедневно 05:00, между
 * `prune-search-query-log` (04:30) и `license-expiry-check` (06:00) — окно низкой нагрузки,
 * порядок с соседними джобами не критичен (независимые таблицы).
 */
export const CART_CLEANUP_QUEUE = 'cart-cleanup'
export const CART_CLEANUP_JOB_NAME = 'cart-cleanup-tick'
export const CART_CLEANUP_SCHEDULER_ID = 'cart-cleanup-daily'
export const CART_CLEANUP_CRON = '0 5 * * *'
export const CART_CLEANUP_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const CART_CLEANUP_QUEUE_TOKEN = Symbol('CART_CLEANUP_QUEUE')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба выполняет только `DELETE FROM cart`. */
export const CART_CLEANUP_DB_POOL = Symbol('CART_CLEANUP_DB_POOL')

/** DI-токен горизонта хранения корзины ЗАРЕГИСТРИРОВАННОГО покупателя в днях (ENV `CART_ABANDONED_TTL_DAYS`). */
export const CART_ABANDONED_TTL_DAYS = Symbol('CART_ABANDONED_TTL_DAYS')

/** DI-токен горизонта хранения ГОСТЕВОЙ корзины в днях (ENV `CART_ABANDONED_GUEST_TTL_DAYS`). */
export const CART_ABANDONED_GUEST_TTL_DAYS = Symbol('CART_ABANDONED_GUEST_TTL_DAYS')
