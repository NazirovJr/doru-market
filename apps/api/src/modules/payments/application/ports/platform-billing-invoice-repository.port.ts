/**
 * Порт `PlatformBillingInvoiceRepository` (EP-10, DTJ-251, REQ-MON-6/9). ДОБАВЛЕНО этим
 * тикетом, НЕ в буквальном `files_owned` (`platform-billing-invoice.repository.ts` — только
 * реализация) — тот же приём, что `payout-schedule-repository.port.ts`/DTJ-249: интерфейс
 * порта живёт при своём репозитории (`02` §1.3), без него `application`-слой был бы вынужден
 * импортировать конкретный Drizzle-класс из `infrastructure/**`, что `dependency-cruiser`
 * (`application-does-not-know-infrastructure`) отклоняет механически.
 *
 * ВАЖНО: `apps/worker` (`CashCommissionAggregationJob`) НЕ использует этот порт — нет пути
 * импорта между `apps/*` в этой монорепе (см. JSDoc `escrow-reconciliation.job.ts`). Джоба
 * мутирует `platform_billing_invoices` СВОИМ раздельным raw-SQL адаптером
 * (`pg-cash-commission-aggregation.adapter.ts`) — тот же класс независимого дублирования
 * доступа к ОДНОЙ физической таблице из двух процессов, что уже установлен `payout_schedule`
 * (`DrizzlePayoutScheduleRepository` здесь + `PgPayoutSchedulerAdapter` в apps/worker, DTJ-249).
 * Этот порт — задел для БУДУЩЕГО apps/api-потребителя (DTJ-252, `GET .../billing-invoices`) —
 * тот же приём, что `ESCROW_LEDGER_REPOSITORY` был забинжен DTJ-240 до первого вызывающего кода.
 *
 * `tenantId` НЕ параметр методов — `platform_billing_invoices` скоупится `chain_id`
 * (`pharmacy_chains`), не тенантом напрямую (сеть — B2B-сущность верхнего уровня, REQ-MON-6);
 * будущий потребитель (DTJ-252) добавит собственную проверку «сеть принадлежит тенанту вызова»
 * на своём уровне (presentation/application), если потребуется — здесь чистый CRUD над таблицей.
 */
export interface PlatformBillingInvoiceRow {
  readonly id: string
  readonly chainId: string
  readonly status: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly subtotalDiram: bigint
  readonly vatDiram: bigint
  readonly totalDiram: bigint
}

/** Вход `upsertDraft` — объект-параметр (C5, `max-params` ≤3). */
export interface UpsertDraftInput {
  readonly chainId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly additionalSubtotalDiram: bigint
}

/** Вход `issue` — объект-параметр (C5), уже посчитанные `vat`/`total` (см. `cash-commission-vat.util.ts`, apps/worker — формула ЖИВЁТ там, этот репозиторий только персистирует). */
export interface IssueInvoiceInput {
  readonly invoiceId: string
  readonly issuedAt: Date
  readonly dueAt: Date
  readonly vatDiram: bigint
  readonly totalDiram: bigint
}

export const PLATFORM_BILLING_INVOICE_REPOSITORY = Symbol.for('@dorutj/payments/platform-billing-invoice-repository')

export interface PlatformBillingInvoiceRepository {
  /** `invoice_type='cash_courier_commission'` неявно — единственный тип, который знает этот тикет. */
  findDraftForPeriod(chainId: string, periodStart: Date): Promise<PlatformBillingInvoiceRow | null>

  /**
   * Создаёт `status='draft'` строку периода, если её ещё нет, ИЛИ добавляет
   * `additionalSubtotalDiram` к уже существующей (upsert по `(chain_id, invoice_type,
   * period_start)`, см. JSDoc миграции `0038_platform_billing_invoices.sql`). `vat_diram`
   * остаётся `0`/`total_diram = subtotal_diram` во время `draft` (НДС считается только при
   * переходе в `issued`, см. `issue`).
   */
  upsertDraft(input: UpsertDraftInput): Promise<void>

  /** `draft → issued`. Given инвойс уже НЕ `draft` (повторный вызов) → no-op, не бросает. */
  issue(input: IssueInvoiceInput): Promise<void>
}
