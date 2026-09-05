/**
 * Ядро джобы `cash-commission-aggregation` (EP-10, DTJ-251, SRS-PAY-036,
 * `21-module-orders-payments-escrow.md` §TC-PAY-012) — B2B-инвойс комиссии за `cash_courier`.
 * Единственный реальный источник дохода платформы за наличные заказы в R1-проде (D-25:
 * `cash_courier` не порождает `escrow_ledger`/`payout_schedule`, см. JSDoc
 * `capture-escrow.use-case.ts`) — буквальный текст «Задача» тикета.
 *
 * ДВА независимых метода на ОДНОМ классе — `runDailyAggregation`/`runWeeklyIssue` — тот же
 * файл джобы, второй cron (буквальный текст тикета «Что сделать» п.3), а не проверка «сегодня
 * воскресенье» внутри одного тика: раздельные BullMQ-расписания (`cash-commission-aggregation.
 * scheduler.ts`) детерминированы и НЕЗАВИСИМО тестируемы, не зависят от точного часа запуска
 * ежедневного тика относительно полуночи.
 *
 * `Promise.allSettled`, не `Promise.all` (зеркало `EscrowReconciliationJob`/
 * `PayoutSchedulerJob`) — ошибка ОДНОЙ сети/ОДНОГО инвойса не должна прерывать обработку
 * остальных в том же тике.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { CASH_COMMISSION_AGGREGATION_CONSUMER } from './cash-commission-aggregation.constants.js'
import { addDays, deterministicEventId, startOfDushanbeDay, startOfDushanbeWeek, toDushanbeYYMMDD } from './cash-commission-aggregation.util.js'
import { calculateVat } from './cash-commission-vat.util.js'

export const CASH_COMMISSION_AGGREGATION_PORT = Symbol.for('@dorutj/worker/cash-commission-aggregation-port')

export interface ChainCashCommissionTotal {
  readonly chainId: string
  readonly totalFeeDiram: bigint
}

export interface UpsertDraftSubtotalInput {
  readonly chainId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly additionalSubtotalDiram: bigint
}

export interface DraftInvoiceForIssue {
  readonly id: string
  readonly subtotalDiram: bigint
}

export interface IssueInvoiceCommand {
  readonly invoiceId: string
  readonly issuedAt: Date
  readonly dueAt: Date
  readonly vatDiram: bigint
  readonly totalDiram: bigint
}

export interface CashCommissionAggregationPort {
  /** `GROUP BY chain_id` — `Σ(order_items.platform_fee_diram)` `cash_courier`-`delivered` заказов за `[since, until)`. */
  aggregateByChain(since: Date, until: Date): Promise<readonly ChainCashCommissionTotal[]>
  /** Идемпотентность (AC2) — `true`, если `eventId` НОВЫЙ (см. `deterministicEventId`). */
  markProcessed(eventId: string): Promise<boolean>
  /** upsert draft-инвойса периода, аккумулируя `additionalSubtotalDiram`. */
  upsertDraftSubtotal(input: UpsertDraftSubtotalInput): Promise<void>
  /** ВСЕ draft-инвойсы `periodStart` (для еженедельного issue), любая сеть. */
  findDraftsForPeriod(periodStart: Date): Promise<readonly DraftInvoiceForIssue[]>
  /** `draft → issued`, входные `vat`/`total` уже посчитаны (`calculateVat`). */
  issueInvoice(cmd: IssueInvoiceCommand): Promise<void>
}

export interface DailyAggregationResult {
  readonly chainsProcessed: number
  readonly skippedDuplicates: number
}

export interface WeeklyIssueResult {
  readonly issued: number
}

const DAYS_PER_WEEK = 7
/** Срок оплаты B2B-инвойса (буквальный текст DoD «due_at = issued_at + 7 дней»). */
const DUE_DAYS_AFTER_ISSUE = 7

type ChainOutcome = 'processed' | 'skipped'

/** Вход `processChainTotal` — объект-параметр (C5, `max-params` ≤3): значения константны на весь тик, вычисляются один раз в `runDailyAggregation`. */
interface DailyTickContext {
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly dateKey: string
}

@Injectable()
export class CashCommissionAggregationJob {
  private readonly logger = new Logger(CashCommissionAggregationJob.name)

  constructor(@Inject(CASH_COMMISSION_AGGREGATION_PORT) private readonly port: CashCommissionAggregationPort) {}

  /** Ежедневный тик: агрегирует `[вчера 00:00, сегодня 00:00)` Dushanbe по сетям, добавляет к draft-инвойсу текущей недели. */
  async runDailyAggregation(now: Date = new Date()): Promise<DailyAggregationResult> {
    const since = startOfDushanbeDay(addDays(now, -1))
    const until = startOfDushanbeDay(now)
    const totals = await this.port.aggregateByChain(since, until)
    const periodStart = startOfDushanbeWeek(now)
    const context: DailyTickContext = {
      periodStart,
      periodEnd: addDays(periodStart, DAYS_PER_WEEK),
      // «та же дата» — вчера (обрабатываемые сутки), не «сегодня» (см. JSDoc deterministicEventId).
      dateKey: toDushanbeYYMMDD(addDays(now, -1)),
    }

    const settled = await Promise.allSettled(totals.map((total) => this.processChainTotal(total, context)))
    this.logSettledErrors('daily-aggregation', settled, totals.map((t) => t.chainId))
    const result = this.summarizeDaily(settled)
    this.logger.log(
      `cash-commission-aggregation: ежедневный тик выполнен — сетей обработано ${String(result.chainsProcessed)}, ` +
        `дублей пропущено ${String(result.skippedDuplicates)}`,
    )
    return result
  }

  /** Еженедельный тик: находит ВСЕ draft-инвойсы текущей недели, переводит в issued с НДС/итогом/сроком оплаты. */
  async runWeeklyIssue(now: Date = new Date()): Promise<WeeklyIssueResult> {
    const periodStart = startOfDushanbeWeek(now)
    const drafts = await this.port.findDraftsForPeriod(periodStart)

    const settled = await Promise.allSettled(drafts.map((draft) => this.issueDraft(draft, now)))
    this.logSettledErrors(
      'weekly-issue',
      settled,
      drafts.map((d) => d.id),
    )
    const issued = settled.filter((r) => r.status === 'fulfilled').length
    this.logger.log(`cash-commission-aggregation: еженедельный issue выполнен — инвойсов issued ${String(issued)}`)
    return { issued }
  }

  private async processChainTotal(total: ChainCashCommissionTotal, context: DailyTickContext): Promise<ChainOutcome> {
    const eventId = deterministicEventId(CASH_COMMISSION_AGGREGATION_CONSUMER, total.chainId, context.dateKey)
    const isNew = await this.port.markProcessed(eventId)
    if (!isNew) return 'skipped' // AC2 — повторный прогон за ту же дату не удваивает subtotal
    await this.port.upsertDraftSubtotal({
      chainId: total.chainId,
      periodStart: context.periodStart,
      periodEnd: context.periodEnd,
      additionalSubtotalDiram: total.totalFeeDiram,
    })
    return 'processed'
  }

  private async issueDraft(draft: DraftInvoiceForIssue, issuedAt: Date): Promise<void> {
    const { vatDiram, totalDiram } = calculateVat(draft.subtotalDiram)
    const dueAt = addDays(issuedAt, DUE_DAYS_AFTER_ISSUE)
    await this.port.issueInvoice({ invoiceId: draft.id, issuedAt, dueAt, vatDiram, totalDiram })
  }

  private summarizeDaily(settled: readonly PromiseSettledResult<ChainOutcome>[]): DailyAggregationResult {
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<ChainOutcome> => r.status === 'fulfilled')
    const chainsProcessed = fulfilled.filter((r) => r.value === 'processed').length
    const skippedDuplicates = fulfilled.filter((r) => r.value === 'skipped').length
    return { chainsProcessed, skippedDuplicates }
  }

  private logSettledErrors(tick: string, settled: readonly PromiseSettledResult<unknown>[], ids: readonly string[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const id = ids[idx] ?? '?'
      return [`${id}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`cash-commission-aggregation (${tick}): ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
