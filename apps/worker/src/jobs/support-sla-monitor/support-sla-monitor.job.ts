/**
 * `SupportSlaMonitorJob` (EP-14, DTJ-280, SRS-ADM-076). Периодически находит тикеты поддержки с
 * просроченным SLA первого ответа (`first_response_due_at < now() AND first_responded_at IS
 * NULL`) и эскалирует их приоритет через `apps/api` (`EscalateTicketPriorityUseCase`, вызванный
 * через internal HTTP-мост — тот же принцип, что `PickupSlaTimeoutJob`/`UnpaidOrderTimeoutJob`,
 * DTJ-253/254: apps/worker сканирует БД САМ, но мутацию агрегата поручает apps/api).
 *
 * Анти-дребезг повторной эскалации (критерий приёмки 3) — забота SQL-скана
 * (`pg-support-sla-scanner.adapter.ts`, `last_escalated_at` в `WHERE`), не этого класса: если
 * тикет уже эскалирован в пределах `reEscalationCooldownMinutes`, скан просто не возвращает его
 * снова — этот класс безусловно эскалирует всё, что получил.
 *
 * Изоляция сбоев (критерий приёмки 4, C14) — `Promise.allSettled`, не `Promise.all`: провал
 * эскалации одного тикета не блокирует остальные тикеты того же тика.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  requestEscalateSupportTicketPriority,
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  type EscalateSupportTicketDeps,
} from './escalate-support-ticket.client.js'
import { SUPPORT_SLA_RE_ESCALATION_MINUTES } from './support-sla-monitor.constants.js'

export const SUPPORT_SLA_TICKET_SCANNER = Symbol.for('@dorutj/worker/support-sla-ticket-scanner')

export interface OverdueSupportTicket {
  readonly ticketId: string
  readonly tenantId: string
}

export interface SupportSlaTicketScannerPort {
  findOverdueTickets(now: Date, reEscalationCooldownMinutes: number): Promise<readonly OverdueSupportTicket[]>
}

export interface SupportSlaMonitorResult {
  readonly scanned: number
  readonly escalated: number
  readonly failed: number
}

@Injectable()
export class SupportSlaMonitorJob {
  private readonly logger = new Logger(SupportSlaMonitorJob.name)

  constructor(
    @Inject(SUPPORT_SLA_TICKET_SCANNER) private readonly scanner: SupportSlaTicketScannerPort,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
    @Inject(SUPPORT_SLA_RE_ESCALATION_MINUTES) private readonly reEscalationCooldownMinutes: number,
  ) {}

  async runOnce(now: Date = new Date()): Promise<SupportSlaMonitorResult> {
    const overdue = await this.scanner.findOverdueTickets(now, this.reEscalationCooldownMinutes)
    const deps: EscalateSupportTicketDeps = { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey }
    const settled = await Promise.allSettled(overdue.map((ticket) => this.escalateOne(ticket, deps)))
    this.logSettledErrors(settled, overdue)
    const result = this.summarize(overdue.length, settled)
    this.logger.log(
      `support-sla-monitor: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `эскалировано ${String(result.escalated)}, ошибок ${String(result.failed)}`,
    )
    return result
  }

  private async escalateOne(ticket: OverdueSupportTicket, deps: EscalateSupportTicketDeps): Promise<void> {
    await requestEscalateSupportTicketPriority(deps, ticket.ticketId)
  }

  private summarize(scanned: number, settled: readonly PromiseSettledResult<void>[]): SupportSlaMonitorResult {
    const escalated = settled.filter((r) => r.status === 'fulfilled').length
    const failed = settled.filter((r) => r.status === 'rejected').length
    return { scanned, escalated, failed }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<void>[], tickets: readonly OverdueSupportTicket[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const ticketId = tickets[idx]?.ticketId ?? '?'
      return [`${ticketId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`support-sla-monitor: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
