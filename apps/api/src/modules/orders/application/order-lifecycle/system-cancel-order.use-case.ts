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
 * ОБОИХ use case'ов — не продублирован). Отмена, release stock и рефанд-если-нужен — общий
 * `OrderCancellationService` (одна формула `isRefundRequired`, D-25, гарантия доведения рефанда).
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
import { NotFoundError, type OrderStatus } from '@dorutj/contracts'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import type { OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'
import { OrderCancellationService } from './order-cancellation.service.js'

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

@Injectable()
export class SystemCancelOrderUseCase {
  // eslint-disable-next-line max-params -- конструктор NestJS с DI-инъекциями (явный @Inject на каждой, DTJ-001).
  constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(OrderCancellationService) private readonly cancellation: OrderCancellationService,
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

    const { refundIssued } = await this.cancellation.cancel({
      order,
      reason: cmd.reason,
      actor: { kind: 'system' },
      now: this.clock.now(),
    })

    this.logger.info({ orderId: cmd.orderId, reason: cmd.reason, refundIssued }, 'order_system_cancelled')
    return { orderId: cmd.orderId, status: 'cancelled', refundIssued }
  }

  private logSkipped(cmd: SystemCancelOrderCommand, actualStatus: OrderStatus): void {
    this.logger.warn(
      { orderId: cmd.orderId, expectedFromStatus: cmd.expectedFromStatus, actualStatus, reason: cmd.reason },
      'order_system_cancel_skipped_status_mismatch',
    )
  }
}
