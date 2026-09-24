import { Injectable } from '@nestjs/common'
import type { DomainEventEnvelope } from '@dorutj/contracts'

export interface DomainEventHandler {
  readonly consumerName: string
  readonly eventTypes: readonly string[]
  handle(envelope: DomainEventEnvelope): Promise<void>
}

// Обработчик регистрируется сам (onModuleInit → register()) — роутер не правится при добавлении нового.
@Injectable()
export class DomainEventHandlerRegistry {
  private readonly handlers: DomainEventHandler[] = []

  register(handler: DomainEventHandler): void {
    this.handlers.push(handler)
  }

  getHandlersFor(eventType: string): readonly DomainEventHandler[] {
    return this.handlers.filter((handler) => handler.eventTypes.includes(eventType))
  }
}
