/**
 * `PgCashCommissionAggregationAdapter` (DTJ-251) — реализация `CashCommissionAggregationPort`
 * поверх `pg.Pool`. Раздельный от apps/api `DrizzlePlatformBillingInvoiceRepository` путь
 * доступа к ОДНОЙ физической таблице (`platform_billing_invoices`) — см. JSDoc порта
 * `platform-billing-invoice-repository.port.ts` (apps/api) про этот класс необходимого
 * дублирования через границу процесса/деплоя, уже установленный `payout_schedule` (DTJ-249).
 *
 * `markProcessed` переиспользует ФИЗИЧЕСКУЮ таблицу `processed_events` (EP-01, DTJ-016,
 * `apps/api/src/db/schema/processed-events.schema.ts`) — та же таблица, что
 * `ProcessedEventsPort`/`DrizzleProcessedEventsRepository` использует со стороны apps/api
 * (`CaptureEscrowUseCase`), здесь — raw SQL с ТЕМ ЖЕ составным PK `(consumer_name, event_id)`
 * (см. JSDoc `cash-commission-aggregation.util.ts` про выбор этого варианта идемпотентности).
 *
 * `upsertDraftSubtotal` — `ON CONFLICT (chain_id, invoice_type, period_start)` (уникальность из
 * миграции `0038_platform_billing_invoices.sql`) `DO UPDATE ... WHERE status='draft'`: если
 * строка уже `issued` (поздно пришедший заказ прошлого периода — граничный случай, вне
 * буквального текста тикета), `WHERE`-условие блокирует апдейт — конфликт «молча» не
 * применяется (не бросает, не портит уже выставленный инвойс), а не падает джобу целиком.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { CASH_COMMISSION_AGGREGATION_CONSUMER, CASH_COMMISSION_AGGREGATION_DB_POOL } from './cash-commission-aggregation.constants.js'
import type {
  CashCommissionAggregationPort,
  ChainCashCommissionTotal,
  DraftInvoiceForIssue,
  IssueInvoiceCommand,
  UpsertDraftSubtotalInput,
} from './cash-commission-aggregation.job.js'

const CASH_COURIER_COMMISSION_TYPE = 'cash_courier_commission'

const AGGREGATE_BY_CHAIN_QUERY = `
  SELECT p.chain_id AS chain_id, SUM(oi.platform_fee_diram) AS total_fee_diram
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN pharmacies p ON p.id = o.pharmacy_id
  WHERE o.payment_method = 'cash_courier'
    AND o.status = 'delivered'
    AND o.deleted_at IS NULL
    AND o.delivered_at >= $1
    AND o.delivered_at < $2
    AND p.chain_id IS NOT NULL
  GROUP BY p.chain_id
`

const MARK_PROCESSED_QUERY = `
  INSERT INTO processed_events (consumer_name, event_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING
  RETURNING event_id
`

const UPSERT_DRAFT_QUERY = `
  INSERT INTO platform_billing_invoices
    (chain_id, invoice_type, status, period_start, period_end, subtotal_diram, vat_diram, total_diram)
  VALUES ($1, '${CASH_COURIER_COMMISSION_TYPE}', 'draft', $2, $3, $4, 0, $4)
  ON CONFLICT (chain_id, invoice_type, period_start) DO UPDATE SET
    subtotal_diram = platform_billing_invoices.subtotal_diram + EXCLUDED.subtotal_diram,
    total_diram = platform_billing_invoices.total_diram + EXCLUDED.subtotal_diram
  WHERE platform_billing_invoices.status = 'draft'
`

const FIND_DRAFTS_FOR_PERIOD_QUERY = `
  SELECT id, subtotal_diram
  FROM platform_billing_invoices
  WHERE invoice_type = '${CASH_COURIER_COMMISSION_TYPE}' AND status = 'draft' AND period_start = $1
`

const ISSUE_INVOICE_QUERY = `
  UPDATE platform_billing_invoices
  SET status = 'issued', issued_at = $2, due_at = $3, vat_diram = $4, total_diram = $5
  WHERE id = $1 AND status = 'draft'
`

interface AggregateByChainRow {
  readonly chain_id: string
  readonly total_fee_diram: string
}

interface DraftRow {
  readonly id: string
  readonly subtotal_diram: string
}

@Injectable()
export class PgCashCommissionAggregationAdapter implements CashCommissionAggregationPort {
  constructor(@Inject(CASH_COMMISSION_AGGREGATION_DB_POOL) private readonly pool: Pool) {}

  async aggregateByChain(since: Date, until: Date): Promise<readonly ChainCashCommissionTotal[]> {
    const result = await this.pool.query<AggregateByChainRow>(AGGREGATE_BY_CHAIN_QUERY, [since, until])
    return result.rows.map((row) => ({ chainId: row.chain_id, totalFeeDiram: BigInt(row.total_fee_diram) }))
  }

  async markProcessed(eventId: string): Promise<boolean> {
    const result = await this.pool.query(MARK_PROCESSED_QUERY, [CASH_COMMISSION_AGGREGATION_CONSUMER, eventId])
    return (result.rowCount ?? 0) > 0
  }

  async upsertDraftSubtotal(input: UpsertDraftSubtotalInput): Promise<void> {
    await this.pool.query(UPSERT_DRAFT_QUERY, [input.chainId, input.periodStart, input.periodEnd, input.additionalSubtotalDiram])
  }

  async findDraftsForPeriod(periodStart: Date): Promise<readonly DraftInvoiceForIssue[]> {
    const result = await this.pool.query<DraftRow>(FIND_DRAFTS_FOR_PERIOD_QUERY, [periodStart])
    return result.rows.map((row) => ({ id: row.id, subtotalDiram: BigInt(row.subtotal_diram) }))
  }

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<void> {
    await this.pool.query(ISSUE_INVOICE_QUERY, [cmd.invoiceId, cmd.issuedAt, cmd.dueAt, cmd.vatDiram, cmd.totalDiram])
  }
}
