/**
 * `PickupSlaTimeoutJob` (EP-10, DTJ-254, SRS-DOM-092/179, SRS-ORD-035/036) — авто-отмена заказа,
 * который аптека не приняла в сборку за `pickup_sla + pickup_sla_buffer`. ОДИН таймер/условие, но
 * ДВА исходных статуса, симметричных по SRS-DOM-092/179 (D-25): `paid_escrow` (non-cash, деньги
 * уже в эскроу — отмена требует полного рефанда) и `confirmed` (cash, наличные никогда не
 * собирались курьером — отмена БЕЗ рефанда). Перепутать ветви — прямой финансовый инцидент
 * (тикет называет это САМЫМ рискованным местом эпика наравне с DTJ-222/230).
 *
 * Структура — БУКВАЛЬНОЕ зеркало `UnpaidOrderTimeoutJob` (DTJ-253, см. её JSDoc «МОСТ МЕЖДУ
 * ПРОЦЕССАМИ» для полного обоснования) — тот же владелец-паттерн, обязательный прецедент этого
 * тикета: джоба — ТОЛЬКО сканер (`PickupSlaOrderScannerPort`, `SELECT`-only), денежное решение
 * (cancel + условный рефанд) физически исполняется в `apps/api`, недостижимом отсюда напрямую
 * (`apps/worker` не зависит от `@dorutj/api` — отдельные TS-проекты монорепо). Мост — ТОТ ЖЕ HTTP
 * вызов, что DTJ-253: `POST /api/v1/internal/orders/:id/system-cancel`
 * (`requestSystemOrderCancel`, `system-order-cancel.client.ts`) — файл УЖЕ типизирует
 * `expectedFromStatus: 'pending_payment' | 'paid_escrow' | 'confirmed'` и
 * `reason: 'payment_timeout' | 'pickup_sla_timeout'` ИМЕННО ради ДВУХ потребителей (DTJ-253 этот,
 * DTJ-254 — этот файл), никаких правок клиента не требуется.
 *
 * ЗАЩИТА ОТ ПУТАНИЦЫ ВЕТВЕЙ (главный риск тикета): `expectedFromStatus` в каждом HTTP-вызове —
 * СТАТУС, КОТОРЫЙ ЭТА СТРОКА РЕАЛЬНО ИМЕЛА в результате SQL-скана (`ExpiredPickupOrder.status`),
 * а НЕ константа — одна и та же джоба обслуживает ОБЕ ветки одним и тем же циклом, и денежное
 * решение (рефанд/NOOP) целиком принимает `SystemCancelOrderUseCase` (apps/api, DTJ-253, УЖЕ
 * реализован и протестирован для ОБЕИХ веток — `system-cancel-order.use-case.spec.ts`/
 * `.integration.spec.ts`, тесты буквально помечены «DTJ-254») — эта джоба НИКОГДА не решает
 * денежный вопрос сама, только передаёт корректно НАБЛЮДЁННЫЙ статус.
 *
 * `Promise.allSettled`, не `Promise.all` (тот же приём, что `UnpaidOrderTimeoutJob`/
 * `EscrowReconciliationJob`) — ошибка отмены ОДНОГО заказа не должна прерывать обработку
 * остальных заказов того же тика (явное требование раздела «Риски» тикета).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  requestSystemOrderCancel,
  type SystemCancelExpectedStatus,
  type SystemOrderCancelDeps,
} from './system-order-cancel.client.js'

export const PICKUP_SLA_ORDER_SCANNER = Symbol.for('@dorutj/worker/pickup-sla-order-scanner')

/** Статусы, из которых `PickupSlaTimeoutJob` легально забирает заказ (D-25, SRS-DOM-092/179). */
export type PickupSlaExpiredStatus = Extract<SystemCancelExpectedStatus, 'paid_escrow' | 'confirmed'>

export interface ExpiredPickupOrder {
  readonly orderId: string
  readonly tenantId: string
  /** Статус, который РЕАЛЬНО имела эта строка на момент скана — см. JSDoc файла «ЗАЩИТА ОТ ПУТАНИЦЫ ВЕТВЕЙ». */
  readonly status: PickupSlaExpiredStatus
}

export interface PickupSlaOrderScannerPort {
  /** `orders` с `status IN ('paid_escrow','confirmed')`, `processing_started_at IS NULL`, `pickup_sla+buffer` истёк. */
  findExpiredOrders(now: Date): Promise<readonly ExpiredPickupOrder[]>
}

export interface PickupSlaTimeoutResult {
  readonly scanned: number
  readonly cancelled: number
  readonly skipped: number
}

type OrderOutcome = 'cancelled' | 'skipped'

@Injectable()
export class PickupSlaTimeoutJob {
  private readonly logger = new Logger(PickupSlaTimeoutJob.name)

  // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
  // 3 параметра (порт + 2 ENV-скаляра) — в пределах `max-params` ≤3 (C5), тот же состав, что
  // `UnpaidOrderTimeoutJob`.
  constructor(
    @Inject(PICKUP_SLA_ORDER_SCANNER) private readonly scanner: PickupSlaOrderScannerPort,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
  ) {}

  /** Один тик: сканирует просроченные по pickup SLA заказы (обе ветки), отменяет каждый через HTTP-мост. */
  async runOnce(now: Date = new Date()): Promise<PickupSlaTimeoutResult> {
    const expired = await this.scanner.findExpiredOrders(now)
    const deps: SystemOrderCancelDeps = { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey }
    const settled = await Promise.allSettled(expired.map((order) => this.cancelOne(order, deps)))
    this.logSettledErrors(settled, expired)
    const result = this.summarize(expired.length, settled)
    this.logger.log(
      `pickup-sla-timeout: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `отменено ${String(result.cancelled)}, пропущено ${String(result.skipped)}`,
    )
    return result
  }

  private async cancelOne(order: ExpiredPickupOrder, deps: SystemOrderCancelDeps): Promise<OrderOutcome> {
    const result = await requestSystemOrderCancel(deps, {
      orderId: order.orderId,
      tenantId: order.tenantId,
      // СТРОГО статус ЭТОЙ строки (не константа) — см. JSDoc файла «ЗАЩИТА ОТ ПУТАНИЦЫ ВЕТВЕЙ».
      expectedFromStatus: order.status,
      reason: 'pickup_sla_timeout',
    })
    return result.status
  }

  private summarize(scanned: number, settled: readonly PromiseSettledResult<OrderOutcome>[]): PickupSlaTimeoutResult {
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<OrderOutcome> => r.status === 'fulfilled')
    const cancelled = fulfilled.filter((r) => r.value === 'cancelled').length
    const skipped = fulfilled.filter((r) => r.value === 'skipped').length
    return { scanned, cancelled, skipped }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<OrderOutcome>[], orders: readonly ExpiredPickupOrder[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const orderId = orders[idx]?.orderId ?? '?'
      return [`${orderId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`pickup-sla-timeout: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
