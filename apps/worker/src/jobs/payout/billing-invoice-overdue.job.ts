/**
 * `BillingInvoiceOverdueJob` (EP-10, DTJ-252, SRS-DOM-161, SRS-PAY-037..039, `21-module-orders-
 * payments-escrow.md` §TC-PAY-013) — замыкает B2B-цикл: сеть, не оплатившая B2B-инвойс за
 * `cash_courier`-комиссию дольше grace period, теряет право принимать НОВЫЕ заказы. Уже
 * оформленные заказы клиентов НЕ прерываются (нельзя наказывать клиента за неплатёж сети,
 * буквальный текст «Задача» тикета) — эта джоба НЕ трогает `orders`.
 *
 * Мутация — НЕ здесь напрямую для `pharmacy_chains` (Группа A, чужая таблица `onboarding`):
 * джоба СКАНИРУЕТ `platform_billing_invoices` СВОИМ `pg.Pool` (`BillingInvoiceOverduePort`) и
 * делегирует РЕАЛЬНУЮ приостановку сети через HTTP-мост в `apps/api`
 * (`requestSuspendChainForUnpaidInvoice`, см. её JSDoc и JSDoc `SuspendChainForUnpaidInvoiceController`
 * «apps/worker физически не может вызвать DI-порт apps/api напрямую», тот же факт, что уже
 * установлен DTJ-247/250/253/254 — `apps/worker/package.json` не зависит от `@dorutj/api`).
 *
 * Единая точка проверки блокировки при чекауте — `OnboardingFacade.isPharmacyActive`
 * (`OnboardingStatus`, `pharmacy_chains.status`), ТА ЖЕ ветка, что `PharmacySuspendedEvent`
 * регуляторной приостановки Onboarding-модуля (REQ-ONBOARD-13) — эта джоба лишь производит
 * условие («сеть suspended»), которое `isPharmacyActive` уже читает (DTJ-227/229), не
 * дублирует ЕЁ логику здесь.
 *
 * `issued → overdue` (локальная мутация СВОИМ пулом, ПОСЛЕ успешного HTTP suspend) —
 * естественная идемпотентность повторного тика: следующий скан `WHERE status='issued'` больше
 * НЕ находит уже обработанный инвойс, значит НЕ повторяет HTTP-вызов на каждый тик (сеть уже
 * `suspended` на apps/api — `OnboardingFacade.suspendChainForUnpaidInvoice` идемпотентна и
 * там, см. её JSDoc — но повторный вызов КАЖДЫЙ день для ОДНОГО и того же просроченного
 * инвойса — лишняя нагрузка/шум логов без этого перехода). `billing_invoice_status` УЖЕ несёт
 * значение `'overdue'` (миграция `0038_platform_billing_invoices.sql`/`enums.schema.ts`, DTJ-251,
 * её же JSDoc: «`issued` → `paid`/`overdue` (`BillingInvoiceOverdueJob`, DTJ-252, ВНЕ периметра
 * ТОГО тикета)» — этот тикет реализует ИМЕННО эту сторону перехода, задел уже существовал).
 * Порядок операций — suspend HTTP СНАЧАЛА, markOverdue локально ПОСЛЕ: если HTTP упал, инвойс
 * остаётся `issued` и будет повторно найден следующим тиком (не потерян молча).
 *
 * `Promise.allSettled`, не `Promise.all` (зеркало `UnpaidOrderTimeoutJob`/
 * `CashCommissionAggregationJob`) — ошибка ОДНОЙ сети/ОДНОГО инвойса не должна прерывать
 * обработку остальных в том же тике.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS, SUSPEND_CHAIN_CLIENT_DEPS } from './billing-invoice-overdue.constants.js'
import { requestSuspendChainForUnpaidInvoice, type SuspendChainClientDeps } from './suspend-chain.client.js'

/** DI-токен порта (тот же приём, что `CASH_COMMISSION_AGGREGATION_PORT`/`UNPAID_ORDER_SCANNER` — живёт при своём job-файле, не в `constants.ts`). */
export const BILLING_INVOICE_OVERDUE_PORT = Symbol.for('@dorutj/worker/billing-invoice-overdue-port')

export interface OverdueUnpaidInvoice {
  readonly invoiceId: string
  readonly chainId: string
}

export interface BillingInvoiceOverduePort {
  /** `status='issued' AND due_at IS NOT NULL AND due_at + gracePeriodDays дней < now` (АС1 тикета). */
  findOverdueUnpaidInvoices(now: Date, gracePeriodDays: number): Promise<readonly OverdueUnpaidInvoice[]>
  /** `issued → overdue`. Given инвойс уже НЕ `issued` (повторный вызов/гонка) → no-op, не бросает (см. JSDoc джобы). */
  markOverdue(invoiceId: string): Promise<void>
}

export interface BillingInvoiceOverdueResult {
  readonly scanned: number
  readonly suspended: number
  readonly failed: number
}

type InvoiceOutcome = 'suspended'

@Injectable()
export class BillingInvoiceOverdueJob {
  private readonly logger = new Logger(BillingInvoiceOverdueJob.name)

  // 3 параметра (порт + ENV-скаляр + deps-объект) — в пределах `max-params` ≤3 (C5), тот же
  // приём, что `UnpaidOrderTimeoutJob` (порт + 2 ENV-скаляра); здесь `apiInternalUrl`/
  // `internalApiKey` уже объединены в `SuspendChainClientDeps` (`suspend-chain.client.ts`),
  // иначе было бы 4 параметра.
  constructor(
    @Inject(BILLING_INVOICE_OVERDUE_PORT) private readonly port: BillingInvoiceOverduePort,
    @Inject(BILLING_INVOICE_OVERDUE_GRACE_PERIOD_DAYS) private readonly gracePeriodDays: number,
    @Inject(SUSPEND_CHAIN_CLIENT_DEPS) private readonly deps: SuspendChainClientDeps,
  ) {}

  /** Один тик: сканирует просроченные неоплаченные инвойсы, приостанавливает каждую сеть через HTTP-мост, ничего не пропускает молча. */
  async runOnce(now: Date = new Date()): Promise<BillingInvoiceOverdueResult> {
    const overdue = await this.port.findOverdueUnpaidInvoices(now, this.gracePeriodDays)
    const settled = await Promise.allSettled(overdue.map((invoice) => this.processOne(invoice)))
    this.logSettledErrors(settled, overdue)
    const result = this.summarize(overdue.length, settled)
    this.logger.log(
      `billing-invoice-overdue: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `приостановлено ${String(result.suspended)}, ошибок ${String(result.failed)}`,
    )
    return result
  }

  /** Suspend HTTP СНАЧАЛА, markOverdue локально ПОСЛЕ (см. JSDoc файла про порядок и идемпотентность). */
  private async processOne(invoice: OverdueUnpaidInvoice): Promise<InvoiceOutcome> {
    await requestSuspendChainForUnpaidInvoice(this.deps, invoice.chainId)
    await this.port.markOverdue(invoice.invoiceId)
    return 'suspended'
  }

  private summarize(scanned: number, settled: readonly PromiseSettledResult<InvoiceOutcome>[]): BillingInvoiceOverdueResult {
    const suspended = settled.filter((r) => r.status === 'fulfilled').length
    const failed = settled.filter((r) => r.status === 'rejected').length
    return { scanned, suspended, failed }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<InvoiceOutcome>[], invoices: readonly OverdueUnpaidInvoice[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const invoiceId = invoices[idx]?.invoiceId ?? '?'
      return [`${invoiceId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`billing-invoice-overdue: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
