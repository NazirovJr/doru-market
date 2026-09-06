/**
 * `AddSupportTicketMessageUseCase` (EP-14, DTJ-282) — `POST /api/v1/support-tickets/:id/messages`.
 * Обоснованная достройка (см. «Риски» DTJ-282).
 *
 * RBAC (ticket «Что сделать» п.1): владелец тикета (`ticket.createdBy === actor.userId`) ИЛИ
 * сотрудник поддержки (`SupportTicketsPolicy.canRespond`) — ДВЕ разные ветки допуска, не одна
 * (клиент дописывает в СВОЙ тикет, агент отвечает в ЛЮБОЙ тикет своего тенанта — тенант-скоуп
 * уже обеспечен тем, что `ticketId` пришёл из `:id`, а `findById` не фильтрует по тенанту,
 * см. риск ниже).
 *
 * `ticket.addMessage(message)` (DTJ-278) — идемпотентно фиксирует `firstRespondedAt` ПЕРВЫМ
 * сообщением `support_agent` (не `super_admin`, см. её JSDoc) — эта мутация ЖИВЁТ в домене, use
 * case её не дублирует. `saveMessage`+`save` — ОДНА транзакция (`unitOfWork.run`), т.к. второе
 * может фактически измениться (`firstRespondedAt`), а не только первое.
 *
 * НЕ блокирует сообщения на `closed`-тикете: домен (DTJ-278) не накладывает такого ограничения на
 * `addMessage()` (в отличие от `transitionTo()` → `TicketAlreadyTerminalError`) — DTJ-282 не вводит
 * новое бизнес-правило поверх уже принятого дизайна DTJ-278.
 */
import { ForbiddenError } from '@dorutj/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ID_GENERATOR, type IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import { SupportTicketMessage, TicketNotFoundError } from '../../domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketsRepositoryPort,
} from '../ports/support-tickets-repository.port.js'
import { SUPPORT_UNIT_OF_WORK, type SupportUnitOfWorkPort } from '../ports/support-unit-of-work.port.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { toSupportTicketDetailView, type SupportTicketDetailView } from './get-support-ticket.use-case.js'

export interface AddSupportTicketMessageCommand {
  readonly ticketId: string
  readonly actor: SupportTicketsPolicyActor
  readonly body: string
}

@Injectable()
export class AddSupportTicketMessageUseCase {
  // 4 зависимости — тот же обоснованный превышение C5, что `CreateSupportTicketUseCase`: явный
  // @Inject на каждом параметре держит граф зависимостей видимым в providers[] модуля.
  // eslint-disable-next-line max-params -- см. комментарий выше
  public constructor(
    @Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort,
    @Inject(SUPPORT_UNIT_OF_WORK) private readonly unitOfWork: SupportUnitOfWorkPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: AddSupportTicketMessageCommand): Promise<SupportTicketDetailView> {
    const ticket = await this.repository.findById(command.ticketId)
    if (ticket === null) {
      throw new TicketNotFoundError(command.ticketId)
    }
    const isOwner = ticket.createdBy !== null && ticket.createdBy === command.actor.userId
    if (!isOwner && !SupportTicketsPolicy.canRespond(command.actor, ticket)) {
      throw new ForbiddenError('Actor is not the ticket owner and not support staff', { ticketId: ticket.id })
    }

    const now = this.clock.now()
    const message = SupportTicketMessage.create(
      { id: this.ids.next(), ticketId: ticket.id, authorUserId: command.actor.userId, authorRole: command.actor.role, body: command.body },
      now,
    )
    ticket.addMessage(message)

    const messages = await this.unitOfWork.run(async (tx) => {
      await this.repository.saveMessage(message, tx)
      await this.repository.save(ticket, tx)
      return this.repository.listMessagesByTicketId(ticket.id, tx)
    })
    return toSupportTicketDetailView(ticket, messages)
  }
}
