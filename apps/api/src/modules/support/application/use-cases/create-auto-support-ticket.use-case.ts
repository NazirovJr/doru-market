/**
 * `CreateAutoSupportTicketUseCase` (EP-14, DTJ-281, SRS-ADM-074).
 *
 * Тонкая обёртка над `CreateSupportTicketUseCase` (DTJ-279) с зафиксированными
 * `channel='system_auto'`, `createdBy=null` (не передаём `createdBy` вовсе — домен уже
 * подставляет `null`, см. `SupportTicket.open()`) — единственная точка входа для СИСТЕМНЫХ
 * инициаторов (джоб/use case'ов ДРУГИХ модулей, например `DeliverySlaMonitorJob`, EP-13).
 * Публикуется через `SupportFacade.createAutoTicket` (`modules/support/index.ts`) — НЕ
 * REST-эндпоинт, вызывается server-to-server, тот же паттерн, что
 * `SupportFacade.escalateTicketPriority` (DTJ-280).
 *
 * `actorRole`, требуемый сигнатурой `CreateSupportTicketUseCase.execute()`, здесь —
 * плейсхолдер: единственная ветка, которую он контролирует
 * (`assertOwnershipIfCustomerOrder`), безусловно возвращается РАНЬШЕ проверки роли, когда
 * `command.channel === 'system_auto'` (см. её JSDoc) — значение поля физически не влияет на
 * исход для этого канала.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { SupportTicketStatus } from '@dorutj/contracts'
import { CreateSupportTicketUseCase } from './create-support-ticket.use-case.js'
import type { SupportTicketSummary } from '../ports/support-facade.port.js'

const SYSTEM_ACTOR_ROLE_PLACEHOLDER = 'super_admin' as const
/** `SupportTicket.open()` всегда стартует в `'open'` — переиспользуем известное значение,
 *  не тратим лишний `findById` только ради статуса только что созданного тикета. */
const AUTO_TICKET_INITIAL_STATUS: SupportTicketStatus = 'open'

export interface CreateAutoSupportTicketCommand {
  readonly tenantId: string
  readonly orderId?: string
  readonly category: SupportTicketSummary['category']
  readonly description?: string
}

@Injectable()
export class CreateAutoSupportTicketUseCase {
  public constructor(
    @Inject(CreateSupportTicketUseCase) private readonly createSupportTicket: CreateSupportTicketUseCase,
  ) {}

  public async execute(command: CreateAutoSupportTicketCommand): Promise<SupportTicketSummary> {
    const result = await this.createSupportTicket.execute({
      tenantId: command.tenantId,
      channel: 'system_auto',
      category: command.category,
      actorRole: SYSTEM_ACTOR_ROLE_PLACEHOLDER,
      ...(command.orderId !== undefined && { orderId: command.orderId }),
      ...(command.description !== undefined && { description: command.description }),
    })
    return { id: result.ticketId, status: AUTO_TICKET_INITIAL_STATUS, category: command.category }
  }
}
