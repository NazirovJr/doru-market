/**
 * `RefundOnReturnResolvedSubscriber` (EP-11, DTJ-274) — потребитель `ReturnConfirmedEvent`/
 * `ReturnRejectedEvent` (публикуются `returns`-use case'ами DTJ-273 через `outbox`, тот же
 * модуль — 1:1 приём `OrderDeliveredSubscriber` модуля `payments`, DTJ-244). `handle()` —
 * стабильный ЮНИТ-тестируемый вход, независимый от механизма доставки события.
 *
 * Явно подписывается на ОБА типа событий модуля (см. `ReturnsDomainEvent` в
 * `returns-outbox.port.ts`), но реагирует ТОЛЬКО на `ReturnConfirmedEvent` — отклонённый возврат
 * не триггерит рефанд (п.1 тикета).
 *
 * **МЕХАНИЗМ ПОДПИСКИ — тот же системный пробел, что у `OrderDeliveredSubscriber` (см. её
 * JSDoc «МЕХАНИЗМ ПОДПИСКИ»), НЕ специфичный для этого тикета.** `outbox` → `OutboxRelayWorker`
 * (`apps/worker`) публикует в общую BullMQ-очередь `domain-events`, но НИ ОДИН consumer в
 * `apps/api` её сегодня не слушает (per-event-type роутинг ещё не спроектирован ни для одного
 * потребителя платформы). `handle()` готов к вызову ЛЮБЫМ будущим мостом (внутренний HTTP-эндпоинт
 * по аналогии с `OrderDeliveredController`, ИЛИ прямой in-process вызов — оба паблишер и
 * подписчик уже сегодня живут в одном процессе `apps/api`, в отличие от `delivery`/`payments`) —
 * вне периметра DTJ-274 (`layer: application`, `files_owned` не перечисляет ни контроллер, ни
 * queue-обработчик).
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  RefundOnReturnResolvedUseCase,
  type RefundOnReturnResolvedCommand,
} from './refund-on-return-resolved.use-case.js'
import type { ReturnsDomainEvent } from '../ports/returns-outbox.port.js'

export interface ReturnResolvedEventEnvelope {
  readonly tenantId: string
  /** `outbox.id` строки, доставившей событие — см. JSDoc `RefundOnReturnResolvedCommand.eventId`. */
  readonly eventId: string
  readonly event: ReturnsDomainEvent
}

@Injectable()
export class RefundOnReturnResolvedSubscriber {
  public constructor(@Inject(RefundOnReturnResolvedUseCase) private readonly refundOnReturnResolved: RefundOnReturnResolvedUseCase) {}

  public async handle(envelope: ReturnResolvedEventEnvelope): Promise<void> {
    if (envelope.event.type !== 'ReturnConfirmedEvent') {
      return // `ReturnRejectedEvent`/будущие типы — не триггерят рефанд (см. JSDoc файла).
    }
    const cmd: RefundOnReturnResolvedCommand = {
      tenantId: envelope.tenantId,
      returnId: envelope.event.returnId,
      orderId: envelope.event.orderId,
      reason: envelope.event.reason,
      disposition: envelope.event.disposition,
      eventId: envelope.eventId,
    }
    await this.refundOnReturnResolved.execute(cmd)
  }
}
