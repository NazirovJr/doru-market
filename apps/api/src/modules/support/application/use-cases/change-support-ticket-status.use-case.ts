/**
 * `ChangeSupportTicketStatusUseCase` (EP-14, DTJ-282) — `POST /api/v1/support-tickets/:id/status`.
 * Обоснованная достройка (см. «Риски» DTJ-282).
 *
 * RBAC — `SupportTicketsPolicy.canResolve` (сотрудник поддержки СВОЕГО тенанта, DTJ-281/282).
 * `ticket.transitionTo(status, actor.userId, now)` (DTJ-278) — САМА бросает
 * `TicketAlreadyTerminalError`/`InvalidTicketStatusTransitionError` (`ConflictError`, `409`),
 * централизованные в `@dorutj/contracts` (DTJ-282) — этот use case их НЕ перехватывает, они
 * пропагируют в `AllExceptionsFilter` без второго маппинга (DTJ-282 «Что сделать» п.6).
 *
 * `Idempotency-Key` НЕ требуется на этом маршруте (DTJ-282 «Что сделать» п.1: нет платёжного
 * эффекта, повторный вызов на уже терминальном статусе просто получает `409` от домена) — этот
 * use case не завязан на `IdempotencyInterceptor`.
 *
 * Возвращает `SupportTicketListItem` (БЕЗ переписки) — смена статуса не меняет ленту сообщений,
 * второй запрос `listMessagesByTicketId` был бы лишней круговой поездкой ради поля, которое не
 * изменилось (в отличие от `AddSupportTicketMessageUseCase`, где новое сообщение — сама суть
 * мутации).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, type SupportTicketStatus } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { TicketNotFoundError } from '../../domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketsRepositoryPort,
} from '../ports/support-tickets-repository.port.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { toSupportTicketListItem, type SupportTicketListItem } from './list-support-tickets.use-case.js'

/** 1:1 с `SupportTicketTransitionTarget` (domain, не экспортирован наружу модуля) — `'open'` никогда не цель перехода. */
export type SupportTicketStatusTransitionTarget = Extract<SupportTicketStatus, 'in_progress' | 'resolved' | 'closed'>

export interface ChangeSupportTicketStatusCommand {
  readonly ticketId: string
  readonly actor: SupportTicketsPolicyActor
  readonly status: SupportTicketStatusTransitionTarget
}

@Injectable()
export class ChangeSupportTicketStatusUseCase {
  public constructor(
    @Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: ChangeSupportTicketStatusCommand): Promise<SupportTicketListItem> {
    const ticket = await this.repository.findById(command.ticketId)
    if (ticket === null) {
      throw new TicketNotFoundError(command.ticketId)
    }
    if (!SupportTicketsPolicy.canResolve(command.actor, ticket)) {
      throw new ForbiddenError('Actor is not support staff for this ticket tenant', { ticketId: ticket.id })
    }

    ticket.transitionTo(command.status, command.actor.userId, this.clock.now())
    await this.repository.save(ticket)
    return toSupportTicketListItem(ticket)
  }
}
