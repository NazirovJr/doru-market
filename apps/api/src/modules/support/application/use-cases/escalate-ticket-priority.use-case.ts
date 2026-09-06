/**
 * `EscalateTicketPriorityUseCase` (EP-14, DTJ-280, SRS-ADM-076).
 *
 * Вызывается ИСКЛЮЧИТЕЛЬНО через `POST /api/v1/internal/support-tickets/:id/escalate-priority`
 * (`presentation/internal`, мост `apps/worker → apps/api`, см. её JSDoc «МОСТ МЕЖДУ
 * ПРОЦЕССАМИ» — тот же приём, что `SystemCancelOrderUseCase`, DTJ-253/254): `SupportSlaMonitorJob`
 * (apps/worker) сам находит просроченные тикеты СВОИМ SQL-сканом
 * (`pg-support-sla-scanner.adapter.ts`, вне процесса apps/api, без импорта domain/application
 * этого модуля). Анти-дребезг повторной эскалации — тоже в `WHERE` этого скана
 * (`last_escalated_at`), НЕ здесь: этот use case ВСЕГДА эскалирует переданный `ticketId`
 * безусловно, ровно один раз за вызов — простая команда, вся идемпотентность вынесена туда, где
 * есть видимость на весь батч (воркер), а не на один тикет.
 *
 * `SlaBreachedEvent` публикуется в ТОЙ ЖЕ транзакции, что `UPDATE support_tickets.priority`
 * (тот же паттерн атомарности outbox, что `CreateSupportTicketUseCase`, критерий приёмки 1
 * DTJ-280) — см. риск в JSDoc `sla-breached.event.ts` про реконструированную схему события.
 */
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { TicketNotFoundError } from '../../domain/index.js'
import { SUPPORT_TICKETS_REPOSITORY, type SupportTicketsRepositoryPort } from '../ports/support-tickets-repository.port.js'
import { SUPPORT_TENANT_SETTINGS_PORT, type SupportTenantSettingsPort } from '../ports/support-tenant-settings.port.js'
import { SUPPORT_UNIT_OF_WORK, type SupportUnitOfWorkPort } from '../ports/support-unit-of-work.port.js'
import { SUPPORT_OUTBOX, type SupportOutboxPort } from '../ports/support-outbox.port.js'

export interface EscalateTicketPriorityCommand {
  readonly ticketId: string
}

export interface EscalateTicketPriorityResult {
  readonly ticketId: string
  readonly priority: number
}

@Injectable()
export class EscalateTicketPriorityUseCase {
  // 5 зависимостей — тот же обоснованный превышение C5, что `CreateSupportTicketUseCase`: явный
  // @Inject на каждом параметре держит граф зависимостей видимым в providers[] модуля. Пред-
  // существующий пробел (DTJ-280, обнаружен DTJ-282 при скоуп-линте src/modules/support: раньше
  // не ловился отдельным прогоном ESLint по модулю) — исправлено попутно, тот же файл уже
  // правится этим тикетом (см. JSDoc выше про удалённый ре-экспорт TicketNotFoundError).
  // eslint-disable-next-line max-params -- см. комментарий выше
  public constructor(
    @Inject(SUPPORT_TICKETS_REPOSITORY) private readonly repository: SupportTicketsRepositoryPort,
    @Inject(SUPPORT_TENANT_SETTINGS_PORT) private readonly tenantSettings: SupportTenantSettingsPort,
    @Inject(SUPPORT_UNIT_OF_WORK) private readonly unitOfWork: SupportUnitOfWorkPort,
    @Inject(SUPPORT_OUTBOX) private readonly outbox: SupportOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: EscalateTicketPriorityCommand): Promise<EscalateTicketPriorityResult> {
    const now = this.clock.now()
    return this.unitOfWork.run(async (tx) => {
      const ticket = await this.repository.findById(command.ticketId, tx)
      if (ticket === null) {
        throw new TicketNotFoundError(command.ticketId)
      }
      const slaMinutes = await this.tenantSettings.getFirstResponseSlaMinutes(ticket.tenantId)
      ticket.escalatePriority(now)
      await this.repository.save(ticket, tx)
      await this.outbox.append(
        ticket.tenantId,
        {
          type: 'SlaBreachedEvent',
          entityType: 'support_ticket',
          entityId: ticket.id,
          tenantId: ticket.tenantId,
          breachedAt: now,
          slaMinutes,
        },
        tx,
      )
      return { ticketId: ticket.id, priority: ticket.priority }
    })
  }
}
