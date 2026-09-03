/**
 * `OrderDeliveredSubscriber` (EP-10, DTJ-244) — потребитель `OrderDeliveredEvent` (модуль
 * `delivery`, EP-13, ВНЕ периметра этого тикета — публикующая сторона физически не существует
 * на момент DTJ-244, `10-domain-model.md` §«Ограниченные контексты»). `handle()` — стабильный
 * ЮНИТ-тестируемый вход, НЕЗАВИСИМЫЙ от механизма доставки события.
 *
 * МЕХАНИЗМ ПОДПИСКИ (буквальный текст тикета «Риски»: «зависит от реализации OutboxRelayWorker...
 * если отсутствует — временный прямой HTTP/internal endpoint-заглушка с TODO, не блокировать
 * тикет») — ВЫБРАН временный HTTP-мост (`OrderDeliveredController`, тот же приём, что
 * `system-cancel-order.controller.ts`, DTJ-253/254), НЕ подписка на общую BullMQ-очередь
 * `domain-events` (`apps/worker/src/jobs/outbox-relay/**`, DTJ-002): та очередь — ОДНА на ВСЕ
 * типы событий, несколько независимых `Worker`-консьюмеров на одном имени очереди делят между
 * собой job'ы конкурентно (BullMQ не поддерживает pub/sub-фанаут на одной очереди из коробки) —
 * приаттачить сюда узкий `Worker`, слушающий ТОЛЬКО `OrderDeliveredEvent`, означало бы либо
 * молча воровать чужие job'ы у будущих консьюмеров других типов событий, либо требовать
 * заранее спроектированный роутинг по `job.name`, которого сегодня нет ни у одного потребителя.
 * TODO(EP-13): когда модуль `delivery` появится и определит реальный механизм публикации
 * (прямой вызов в процессе, если `delivery` окажется частью `apps/api`, ИЛИ явный
 * per-event-type роутинг поверх `domain-events`) — заменить HTTP-мост на него, `handle()`
 * этого класса переиспользуется без изменений.
 */
import { Inject, Injectable } from '@nestjs/common'
import { CaptureEscrowUseCase, type CaptureEscrowCommand } from '@/modules/payments/application/use-cases/capture-escrow.use-case.js'

export interface OrderDeliveredEventPayload {
  readonly tenantId: string
  readonly orderId: string
  readonly deliveredAt: Date
  readonly eventId: string
}

@Injectable()
export class OrderDeliveredSubscriber {
  constructor(@Inject(CaptureEscrowUseCase) private readonly captureEscrow: CaptureEscrowUseCase) {}

  async handle(event: OrderDeliveredEventPayload): Promise<void> {
    const cmd: CaptureEscrowCommand = { tenantId: event.tenantId, orderId: event.orderId, eventId: event.eventId }
    await this.captureEscrow.execute(cmd)
  }
}
