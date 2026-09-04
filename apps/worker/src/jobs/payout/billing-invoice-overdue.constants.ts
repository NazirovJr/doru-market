/**
 * Константы и DI-токены джобы `billing-invoice-overdue` (DTJ-252, SRS-DOM-161, SRS-PAY-037..039).
 * Зеркало `unpaid-order-timeout.constants.ts` (DTJ-253) по структуре имён — та же джоба-форма
 * («скан своим `pg.Pool` + HTTP-мост в `apps/api`»), другая таблица/эндпоинт.
 */
export const BILLING_INVOICE_OVERDUE_QUEUE = 'billing-invoice-overdue'
export const BILLING_INVOICE_OVERDUE_JOB_NAME = 'billing-invoice-overdue-tick'
export const BILLING_INVOICE_OVERDUE_SCHEDULER_ID = 'billing-invoice-overdue-periodic'
export const BILLING_INVOICE_OVERDUE_TZ = 'Asia/Dushanbe'

/** DI-токен BullMQ `Queue` служебной очереди тика. */
export const BILLING_INVOICE_OVERDUE_QUEUE_TOKEN = Symbol('BILLING_INVOICE_OVERDUE_QUEUE_TOKEN')

/** DI-токен `pg.Pool`, отдельный от бизнес-пулов apps/api — джоба ЧИТАЕТ `platform_billing_invoices`
 *  и ЛОКАЛЬНО переводит `issued → overdue` (см. JSDoc джобы про идемпотентность повторного тика);
 *  МУТАЦИЮ `pharmacy_chains.status` выполняет исключительно HTTP-мост, не этот пул. */
export const BILLING_INVOICE_OVERDUE_DB_POOL = Symbol('BILLING_INVOICE_OVERDUE_DB_POOL')

/** DI-токен cron-выражения тика (ENV `BILLING_INVOICE_OVERDUE_CRON`, DoD тикета — «ежедневно»). */
export const BILLING_INVOICE_OVERDUE_CRON = Symbol('BILLING_INVOICE_OVERDUE_CRON')

/** DI-токен grace period в днях (ENV `BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS`, DoD тикета — именованная константа). */
export const BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS = Symbol('BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS')

/**
 * DI-токен `SuspendChainClientDeps` (`suspend-chain.client.ts`) — объединяет `API_INTERNAL_URL_
 * TOKEN`/`INTERNAL_API_KEY_TOKEN` (переиспользованы из `escrow-timeouts/system-order-cancel.
 * client.ts`) в ОДИН инжектируемый параметр job'а — иначе `BillingInvoiceOverdueJob` нёс бы 4
 * параметра конструктора (порт + grace period + 2 ENV-скаляра), нарушая `max-params` ≤3 (C5).
 * Тот же приём, что `PaymentProviderRegistry`/`ReconciliationScheduleConfig` — агрегатор-обёртка
 * чисто механической DI-обвязки, без логики.
 */
export const SUSPEND_CHAIN_CLIENT_DEPS = Symbol('SUSPEND_CHAIN_CLIENT_DEPS')
