/**
 * Ядро джобы `escrow-reconciliation` (EP-10, DTJ-247, SRS-PAY-013/014/SRS-PAY-042,
 * `21-module-orders-payments-escrow.md` §4.3) — единственный автоматический страж целостности
 * эскроу-леджера платформы. НЕ пытается исправить расхождение (SRS-PAY-013, «Задача» тикета) —
 * только алертит: `support_tickets(channel='system_auto', category='payment_issue')` +
 * `audit_log(category='ledger_adjustment')` + метрика `escrow_ledger_imbalance_count`.
 *
 * ПОЧЕМУ БАЛАНС СЧИТАЕТСЯ В SQL, НЕ ЧЕРЕЗ `EscrowLedger.isBalanced()` (буквальный текст тикета
 * называет именно её): `EscrowLedger`/`EscrowLedgerEntry` — домен `apps/api/src/modules/
 * payments/domain/**`, `apps/worker` НЕ зависит от `@dorutj/api` физически (проверено —
 * `apps/worker/package.json`, нет пути импорта между `apps/*` в этой монорепе, только через
 * `packages/*`). Формула SRS-PAY-010 (буквально та же, что реализует `EscrowLedger.isBalanced`)
 * пересчитана здесь ОДНИМ агрегирующим SQL-запросом (`PgEscrowReconciliationAdapter.
 * findImbalancedOrders`) — это НЕ дублирование ради лени: (1) устраняет необходимость грузить
 * КАЖДУЮ запись КАЖДОГО заказа в память джобы ради N+1 вызовов, снимая как раз риск
 * производительности, названный в разделе «Риски» тикета; (2) домен `apps/api` физически
 * недостижим отсюда, копия формулы — единственный вариант (тот же класс необходимого
 * дублирования через границу деплоя, что `EscrowLedgerImbalanceMetric`, см. её JSDoc). Тест-план
 * тикета («сбалансированный/разбалансированный набор записей на нескольких заказах
 * одновременно») проверяется через РЕАЛЬНЫЙ Postgres (интеграционный тест), не подменой
 * `isBalanced()` — тождественность формулы доказывается ИМ, не совпадением имени функции.
 *
 * `apps/worker` не мутирует `escrow_ledger`/`orders` НИ ПРИ КАКОМ результате (DoD тикета) —
 * `EscrowReconciliationScannerPort` несёт ТОЛЬКО `findImbalancedOrders` (SELECT), пишущие
 * порты (`SupportTicketPort`/`AuditLogPort`) касаются ТОЛЬКО `support_tickets`/`audit_log`.
 *
 * SRS-PAY-042: повторное обнаружение ТОГО ЖЕ расхождения (тикет уже открыт) НЕ плодит новый
 * `support_ticket` — но `audit_log` получает НОВУЮ строку (append-only, UPDATE физически
 * невозможен — SRS-DB-024, `REVOKE UPDATE, DELETE`, `migrations/0034_support_tickets_audit_log.
 * sql`) с инкрементированным `metadata.repeatDetectionCount` — «обновить audit_log-метаданные»
 * из текста тикета буквально означает ЭТО, не SQL `UPDATE` (который роль БД физически отвергает).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { RECONCILIATION_DEDUP_DAYS } from './escrow-reconciliation.constants.js'
import { EscrowLedgerImbalanceMetric } from './escrow-ledger-imbalance.metric.js'

export interface ImbalancedOrder {
  readonly orderId: string
  readonly tenantId: string
  /** `Σ(hold_created) − [Σ(credit-сторона) + Σ(adjustment,credit) − Σ(adjustment,debit)]`, знак сохранён (SRS-PAY-010). */
  readonly discrepancyDiram: bigint
}

export const ESCROW_RECONCILIATION_SCANNER = Symbol.for('@dorutj/worker/escrow-reconciliation-scanner')
export interface EscrowReconciliationScannerPort {
  /** `order_id` с записями `escrow_ledger` за `since`, у которых расхождение (формула SRS-PAY-010) != 0. */
  findImbalancedOrders(since: Date): Promise<readonly ImbalancedOrder[]>
}

export const SUPPORT_TICKET_PORT = Symbol.for('@dorutj/worker/support-ticket-port')
export interface CreateSystemAutoPaymentIssueTicketInput {
  readonly orderId: string
  readonly tenantId: string
  readonly description: string
}
export interface SupportTicketPort {
  /** Открытый (status NOT IN ('resolved','closed')) `support_ticket(category='payment_issue')` за последние `dedupDays`, если есть. */
  findOpenPaymentIssueTicket(orderId: string, dedupDays: number): Promise<{ ticketId: string } | null>
  createSystemAutoPaymentIssueTicket(input: CreateSystemAutoPaymentIssueTicketInput): Promise<{ ticketId: string }>
}

export const AUDIT_LOG_PORT = Symbol.for('@dorutj/worker/audit-log-port')
export interface AppendLedgerAdjustmentInput {
  readonly orderId: string
  readonly tenantId: string
  readonly discrepancyDiram: bigint
  readonly repeatDetectionCount: number
}
export interface AuditLogPort {
  /** Сколько РАНЕЕ уже было `audit_log(category='ledger_adjustment')` строк для этого заказа (SRS-PAY-042 счётчик). */
  countLedgerAdjustmentEntries(orderId: string): Promise<number>
  appendLedgerAdjustment(input: AppendLedgerAdjustmentInput): Promise<void>
}

export interface EscrowReconciliationResult {
  readonly imbalancedOrders: number
  readonly newTickets: number
  readonly dedupedTickets: number
}

const LOOKBACK_DAYS = 1
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

type OrderOutcome = 'created' | 'deduped'

/**
 * Агрегирует три порта джобы в ОДИН инжектируемый параметр — иначе конструктор `Escrow
 * ReconciliationJob` нёс бы 5 параметров (3 порта + 2 скаляра), нарушая `max-params` ≤3 (C5).
 * Тот же приём, что `PaymentProviderRegistry` (`payments.module.ts`, DTJ-239) — чисто
 * механическая обвязка DI, без логики.
 */
@Injectable()
export class EscrowReconciliationPorts {
  constructor(
    @Inject(ESCROW_RECONCILIATION_SCANNER) public readonly scanner: EscrowReconciliationScannerPort,
    @Inject(SUPPORT_TICKET_PORT) public readonly supportTickets: SupportTicketPort,
    @Inject(AUDIT_LOG_PORT) public readonly auditLog: AuditLogPort,
  ) {}
}

@Injectable()
export class EscrowReconciliationJob {
  private readonly logger = new Logger(EscrowReconciliationJob.name)
  private readonly scanner: EscrowReconciliationScannerPort
  private readonly supportTickets: SupportTicketPort
  private readonly auditLog: AuditLogPort

  constructor(
    ports: EscrowReconciliationPorts,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(RECONCILIATION_DEDUP_DAYS) private readonly dedupDays: number,
    @Inject(EscrowLedgerImbalanceMetric) private readonly imbalanceMetric: EscrowLedgerImbalanceMetric,
  ) {
    this.scanner = ports.scanner
    this.supportTickets = ports.supportTickets
    this.auditLog = ports.auditLog
  }

  /** Один тик: сканирует расхождения за истёкшие сутки, алертит по каждому, ничего не чинит. */
  async runOnce(now: Date = new Date()): Promise<EscrowReconciliationResult> {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * MS_PER_DAY)
    const imbalanced = await this.scanner.findImbalancedOrders(since)
    const settled = await Promise.allSettled(imbalanced.map((order) => this.handleImbalancedOrder(order)))
    this.logSettledErrors(settled, imbalanced)
    const result = this.summarize(settled)
    this.logger.log(
      `escrow-reconciliation: тик выполнен — расхождений ${String(imbalanced.length)}, ` +
        `новых тикетов ${String(result.newTickets)}, дедуплицировано ${String(result.dedupedTickets)}`,
    )
    return result
  }

  /** SRS-PAY-013/042 — см. JSDoc файла: метрика + audit_log ВСЕГДА, support_ticket условно. */
  private async handleImbalancedOrder(order: ImbalancedOrder): Promise<OrderOutcome> {
    this.imbalanceMetric.increment()
    const [existingTicket, priorAdjustments] = await Promise.all([
      this.supportTickets.findOpenPaymentIssueTicket(order.orderId, this.dedupDays),
      this.auditLog.countLedgerAdjustmentEntries(order.orderId),
    ])
    await this.auditLog.appendLedgerAdjustment({
      orderId: order.orderId,
      tenantId: order.tenantId,
      discrepancyDiram: order.discrepancyDiram,
      repeatDetectionCount: priorAdjustments + 1,
    })
    if (existingTicket !== null) {
      return 'deduped'
    }
    await this.supportTickets.createSystemAutoPaymentIssueTicket({
      orderId: order.orderId,
      tenantId: order.tenantId,
      description: `EscrowReconciliationJob: discrepancy ${order.discrepancyDiram.toString()} diram (order ${order.orderId})`,
    })
    return 'created'
  }

  private summarize(settled: readonly PromiseSettledResult<OrderOutcome>[]): EscrowReconciliationResult {
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<OrderOutcome> => r.status === 'fulfilled')
    const newTickets = fulfilled.filter((r) => r.value === 'created').length
    const dedupedTickets = fulfilled.filter((r) => r.value === 'deduped').length
    return { imbalancedOrders: settled.length, newTickets, dedupedTickets }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<OrderOutcome>[], orders: readonly ImbalancedOrder[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const orderId = orders[idx]?.orderId ?? '?'
      return [`${orderId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`escrow-reconciliation: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
