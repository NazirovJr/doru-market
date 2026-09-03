/**
 * `UnpaidOrderTimeoutJob` (EP-10, DTJ-253, SRS-DOM-090, SRS-ORD-032/033/034) — авто-отмена
 * non-cash заказа, застрявшего в `pending_payment` дольше окна на оплату. В R1-проде эта
 * джоба практически находит НОЛЬ строк (наличные никогда не проходят через `pending_payment`,
 * D-25, а `payment_window_expires_at` сегодня НИКЕМ не записывается — см. JSDoc миграции
 * `0036_orders_payment_window_expires_at.sql`, установка поля — ответственность `CheckoutUseCase`
 * EP-09, ВНЕ владения этого тикета) — это ОЖИДАЕМОЕ состояние, зафиксированное явно в отчёте
 * сдачи, а НЕ баг: архитектура обязана быть построена целиком (Pivot §2.2) и протестирована на
 * тестовом non-cash тенанте, независимо от текущей частоты срабатывания в реальном трафике.
 *
 * Мутация заказа — НЕ здесь: джоба только СКАНИРУЕТ (`UnpaidOrderScannerPort`, `SELECT`-only,
 * DoD «джоба НЕ мутирует orders») и делегирует РЕАЛЬНУЮ отмену через HTTP-мост в `apps/api`
 * (`requestSystemOrderCancel`, см. её JSDoc и JSDoc `system-cancel-order.use-case.ts` «МОСТ
 * МЕЖДУ ПРОЦЕССАМИ» — `apps/worker` физически не может вызвать `PaymentsOrdersPort`/
 * `order.cancel()`, они живут в другом Node-процессе).
 *
 * `Promise.allSettled`, не `Promise.all` (зеркало `EscrowReconciliationJob`, DTJ-247) — ошибка
 * отмены ОДНОГО заказа (сетевой сбой, гонка) не должна прерывать обработку остальных заказов
 * того же тика.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  requestSystemOrderCancel,
  type SystemOrderCancelDeps,
} from './system-order-cancel.client.js'

export const UNPAID_ORDER_SCANNER = Symbol.for('@dorutj/worker/unpaid-order-scanner')

export interface ExpiredUnpaidOrder {
  readonly orderId: string
  readonly tenantId: string
}

export interface UnpaidOrderScannerPort {
  /** `orders` с `status='pending_payment'` и `payment_window_expires_at <= now`. */
  findExpiredOrders(now: Date): Promise<readonly ExpiredUnpaidOrder[]>
}

export interface UnpaidOrderTimeoutResult {
  readonly scanned: number
  readonly cancelled: number
  readonly skipped: number
}

type OrderOutcome = 'cancelled' | 'skipped'

@Injectable()
export class UnpaidOrderTimeoutJob {
  private readonly logger = new Logger(UnpaidOrderTimeoutJob.name)

  // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
  // 3 параметра (порт + 2 ENV-скаляра) — в пределах `max-params` ≤3 (C5), агрегатор-обёртка
  // (тот же приём, что `EscrowReconciliationPorts`) здесь не нужен.
  constructor(
    @Inject(UNPAID_ORDER_SCANNER) private readonly scanner: UnpaidOrderScannerPort,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
  ) {}

  /** Один тик: сканирует просроченные заказы, отменяет каждый через HTTP-мост, ничего не пропускает молча. */
  async runOnce(now: Date = new Date()): Promise<UnpaidOrderTimeoutResult> {
    const expired = await this.scanner.findExpiredOrders(now)
    const deps: SystemOrderCancelDeps = { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey }
    const settled = await Promise.allSettled(expired.map((order) => this.cancelOne(order, deps)))
    this.logSettledErrors(settled, expired)
    const result = this.summarize(expired.length, settled)
    this.logger.log(
      `unpaid-order-timeout: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `отменено ${String(result.cancelled)}, пропущено ${String(result.skipped)}`,
    )
    return result
  }

  private async cancelOne(order: ExpiredUnpaidOrder, deps: SystemOrderCancelDeps): Promise<OrderOutcome> {
    const result = await requestSystemOrderCancel(deps, {
      orderId: order.orderId,
      tenantId: order.tenantId,
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    })
    return result.status
  }

  private summarize(scanned: number, settled: readonly PromiseSettledResult<OrderOutcome>[]): UnpaidOrderTimeoutResult {
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<OrderOutcome> => r.status === 'fulfilled')
    const cancelled = fulfilled.filter((r) => r.value === 'cancelled').length
    const skipped = fulfilled.filter((r) => r.value === 'skipped').length
    return { scanned, cancelled, skipped }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<OrderOutcome>[], orders: readonly ExpiredUnpaidOrder[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const orderId = orders[idx]?.orderId ?? '?'
      return [`${orderId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`unpaid-order-timeout: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
