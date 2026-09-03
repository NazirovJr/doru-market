/**
 * `SystemCancelOrderUseCase` (EP-10, DTJ-253/254, SRS-ORD-032..036) — вход отмены заказа для
 * СИСТЕМНОГО инициатора (BullMQ-таймауты `apps/worker`), а не человека.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ USE CASE, НЕ `CancelOrderUseCase` (EP-09, DTJ-232): `CancelOrderUseCase.
 * findAuthorizedOrder` вызывает `OrderPolicy.canCancel(order, actor)`, а та АДРЕСНО отсекает
 * не-человеческих акторов («сама отсекает `super_admin`/`courier`/`support_agent`», JSDoc
 * `CancelOrderUseCase`) — у политики нет и не должно быть ветки «это системный таймаут, пропусти
 * проверку владения». Раздельные use case'ы — не дублирование бизнес-правила, а разделение ДВУХ
 * разных вопросов: «может ли ЭТОТ АКТОР отменить ЭТОТ заказ» (человек, `OrderPolicy`) и «легален
 * ли ЭТОТ ПЕРЕХОД» (state machine, `order.state-machine.ts`, ЕДИНСТВЕННЫЙ источник истины для
 * ОБОИХ use case'ов — не продублирован). Остальная оркестрация (release stock, рефанд-если-нужен)
 * ЦЕЛИКОМ переиспользует ТЕ ЖЕ порты (`InventoryFacadePort`/`RefundFacadePort`) и ТУ ЖЕ формулу
 * `isRefundRequired` (D-25), что `CancelOrderUseCase` — см. JSDoc `isSystemRefundRequired` ниже
 * про причину, почему формула здесь СВОЯ копия, а не импорт приватной функции соседнего файла.
 *
 * МОСТ МЕЖДУ ПРОЦЕССАМИ (ключевое архитектурное решение этого файла, зафиксировано в отчёте
 * сдачи DTJ-253 как `assumptions`): тикеты DTJ-253/254 пишут `PaymentsOrdersPort.cancel(...)`
 * буквально, как будто джоба `apps/worker` может вызвать этот application-порт `apps/payments`
 * напрямую. Физически невозможно: `apps/worker` НЕ зависит от `@dorutj/api` (см. JSDoc
 * `EscrowLedgerImbalanceMetric`/`MockBankAutoPayJob` — тот же факт, уже дважды задокументирован
 * в этом эпике). Реальный путь: джоба `apps/worker` шлёт HTTP `POST /api/v1/internal/orders/:id/
 * system-cancel` (см. `system-cancel-order.controller.ts`) — ТОТ ЖЕ приём моста, что
 * `MockBankAutoPayJob → POST /api/v1/payments/webhook` (DTJ-238). Этот use case — то, что
 * реально исполняется ВНУТРИ процесса `apps/api` по этому HTTP-вызову; `PaymentsOrdersPort.
 * cancel()` (DTJ-236) остаётся верным описанием ВНУТРИпроцессного пути `payments → orders`
 * (используется `LatePaymentRefundService`, DTJ-243), но джобы `apps/worker` физически не могут
 * его достичь — они достигают ЭТОГО use case через HTTP.
 *
 * ЗАЩИТА ОТ ГОНКИ «заказ прогрессировал между SELECT джобы и приходом HTTP-вызова» (не описана
 * буквально в тикетах, найдена при реализации): `expectedFromStatus` — статус, который джоба
 * НАБЛЮДАЛА при своём SQL-сканировании. Если РЕАЛЬНЫЙ статус заказа на момент этого вызова
 * ОТЛИЧАЕТСЯ (например, `pending_payment` заказ успел стать `paid_escrow` ПРЯМО МЕЖДУ сканом
 * джобы и этим вызовом — легитимный вебхук банка обогнал таймаут на миллисекунды) — молча
 * пропустить (`status: 'skipped'`), НЕ звать `order.cancel()` вслепую. Без этой защиты
 * `paid_escrow → cancelled` — ЛЕГАЛЬНЫЙ переход по таблице `order.state-machine.ts` (используется
 * ЗАКОННО из `paid_escrow`/SLA-таймаута, DTJ-254) — таймаут `payment_timeout` отменил бы ТОЛЬКО
 * что оплаченный заказ, что было бы прямым финансовым дефектом, не пойманным ни одним тестом,
 * написанным по буквальному тексту тикета (там гонка не упомянута).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isErr } from '@dorutj/domain-kernel'
import { NotFoundError, PaymentProviderUnavailableError, type OrderPaymentMethod, type OrderStatus } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import {
  INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
  type ReleaseStockItemCommand,
} from '@/modules/orders/application/ports/inventory-facade.port.js'
import { REFUND_FACADE_PORT, type RefundFacadePort } from '@/modules/orders/application/ports/refund-facade.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'

export interface SystemCancelOrderCommand {
  readonly tenantId: string
  readonly orderId: string
  /** Статус, который наблюдал вызывающий (джоба) — см. JSDoc файла «Защита от гонки». */
  readonly expectedFromStatus: OrderStatus
  readonly reason: OrderCancelReason
}

export interface SystemCancelOrderResult {
  readonly orderId: string
  readonly status: 'cancelled' | 'skipped'
  readonly refundIssued: boolean
}

/** Статусы, из которых деньги (non-cash) реально захвачены в эскроу к моменту отмены (D-25).
 * ЗЕРКАЛО `ESCROW_CAPTURED_STATUSES` (`cancel-order.use-case.ts`, EP-09) — НЕ импорт приватной
 * (не экспортированной) константы соседнего модуля/тикета: копия формулы через границу
 * `files_owned` — тот же класс необходимого дублирования, что `EscrowLedgerImbalanceMetric`
 * (apps/api ↔ apps/worker, DTJ-247) — источник D-25 стабилен (архитектурное решение, не
 * реализационная деталь), риск расхождения копий низкий, а альтернатива (экспорт приватной
 * функции ИЗ чужого `files_owned` этим тикетом) нарушала бы правило 7 AGENTS.md сильнее. */
const ESCROW_CAPTURED_STATUSES = new Set<OrderStatus>(['paid_escrow', 'processing'])

function isSystemRefundRequired(preStatus: OrderStatus, paymentMethod: OrderPaymentMethod): boolean {
  if (paymentMethod === 'cash_courier') {
    return false
  }
  return ESCROW_CAPTURED_STATUSES.has(preStatus)
}

function toReleaseItems(order: Order): readonly ReleaseStockItemCommand[] {
  return order.items.map((item) => ({ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity }))
}

@Injectable()
export class SystemCancelOrderUseCase {
  // eslint-disable-next-line max-params -- 3 порта (OrdersFacade/InventoryFacadePort/RefundFacadePort) + Clock + PINO_LOGGER — идентичный состав `CancelOrderUseCase` (см. её JSDoc про explicit @Inject/esbuild DTJ-001), минус OrderPolicy (не читает).
  constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(REFUND_FACADE_PORT) private readonly refundFacade: RefundFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async execute(cmd: SystemCancelOrderCommand): Promise<SystemCancelOrderResult> {
    const order = await this.ordersFacade.getOrderById(cmd.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (order.status !== cmd.expectedFromStatus) {
      this.logSkipped(cmd, order.status)
      return { orderId: cmd.orderId, status: 'skipped', refundIssued: false }
    }

    const refundRequired = isSystemRefundRequired(order.status, order.paymentMethod)
    const releaseItems = toReleaseItems(order)

    await this.ordersFacade.cancel(cmd.orderId, {
      tenantId: cmd.tenantId,
      reason: cmd.reason,
      actor: { kind: 'system' },
      now: this.clock.now(),
    })

    // ВСЕГДА, независимо от денежной ветки (SRS-ORD-029/032..036, тот же порядок, что
    // `CancelOrderUseCase`) — до рефанда: склад не должен держать резерв уже отменённого заказа.
    await this.inventoryFacade.releaseStock(releaseItems)
    if (refundRequired) {
      await this.refundOrThrow(cmd.orderId, cmd.reason)
    }

    this.logger.info(
      { orderId: cmd.orderId, reason: cmd.reason, refundIssued: refundRequired },
      'order_system_cancelled',
    )
    return { orderId: cmd.orderId, status: 'cancelled', refundIssued: refundRequired }
  }

  private async refundOrThrow(orderId: string, reason: OrderCancelReason): Promise<void> {
    const result = await this.refundFacade.refundFull(orderId, reason)
    if (isErr(result)) {
      throw new PaymentProviderUnavailableError({ orderId, cause: result.error })
    }
  }

  private logSkipped(cmd: SystemCancelOrderCommand, actualStatus: OrderStatus): void {
    this.logger.warn(
      { orderId: cmd.orderId, expectedFromStatus: cmd.expectedFromStatus, actualStatus, reason: cmd.reason },
      'order_system_cancel_skipped_status_mismatch',
    )
  }
}
