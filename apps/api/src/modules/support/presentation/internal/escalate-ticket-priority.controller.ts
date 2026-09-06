/**
 * `EscalateTicketPriorityController` (EP-14, DTJ-280/281) —
 * `POST /api/v1/internal/support-tickets/:id/escalate-priority`, единственный HTTP-вход
 * `EscalateTicketPriorityUseCase`.
 *
 * МОСТ МЕЖДУ ПРОЦЕССАМИ (тот же приём, что `SystemCancelOrderController`, DTJ-253/254):
 * `apps/worker` — отдельный процесс/деплой без импорта `apps/api/src/modules/support` (`02` §1.1 —
 * межмодульные и, тем более, межпроцессные deep-import'ы запрещены). `SupportSlaMonitorJob`
 * (apps/worker) сам находит просроченные тикеты СВОИМ SQL-сканом (без Drizzle/domain этого
 * модуля), и для каждого бьёт на этот internal-эндпоинт, единственный вызывающий —
 * ИСКЛЮЧИТЕЛЬНО `apps/worker`, ни один браузер/мобильный клиент этот путь не видит
 * (`SupportInternalServiceGuard`, тот же секрет `INTERNAL_API_KEY`).
 *
 * Тело запроса ПУСТОЕ (`ticketId` — из пути) — в отличие от `system-cancel`, эскалация не несёт
 * дополнительного бизнес-контекста, который воркер обязан передать (никакого `tenantId`/
 * `expectedFromStatus`: `EscalateTicketPriorityUseCase` сам читает `tenantId` тикета через
 * репозиторий).
 *
 * ДОБАВЛЕНО (DTJ-281): вызывает `EscalateTicketPriorityUseCase` ЧЕРЕЗ `SupportFacade`
 * (`SUPPORT_FACADE`), не напрямую use case, как было временно на шаге DTJ-280 (`SupportFacade`
 * тогда ещё не имел реализации метода) — единообразие точки входа, DTJ-281 «Что сделать» п.3:
 * «используется DTJ-280 через фасад, не напрямую use case, даже изнутри своего же модуля».
 * `TicketNotFoundError` по-прежнему импортируется из `application/` (не `domain/` напрямую) —
 * см. ре-экспорт в `escalate-ticket-priority.use-case.ts`, `presentation-goes-through-application`.
 */
import { Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { TicketNotFoundError } from '@/modules/support/application/use-cases/escalate-ticket-priority.use-case.js'
import { SUPPORT_FACADE, type SupportFacade, type EscalateTicketPriorityFacadeResult } from '@/modules/support/index.js'
import { SupportInternalServiceGuard } from './support-internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/support-tickets', version: '1' })
@UseGuards(SupportInternalServiceGuard)
export class EscalateTicketPriorityController {
  public constructor(@Inject(SUPPORT_FACADE) private readonly supportFacade: SupportFacade) {}

  @Post(':id/escalate-priority')
  @HttpCode(HttpStatus.OK)
  public async escalate(
    @Param('id', ID_PARSE_UUID) ticketId: string,
  ): Promise<SuccessEnvelope<EscalateTicketPriorityFacadeResult>> {
    try {
      const result = await this.supportFacade.escalateTicketPriority(ticketId)
      return ok(result)
    } catch (error) {
      // Гонка «тикет удалён/не существует между SQL-сканом воркера и этим вызовом» — 404, не
      // проглоченный 500 (C12). Точный доменный ErrorCode (TICKET_NOT_FOUND) — периметр DTJ-282
      // (`packages/contracts/src/errors.ts`, следующий тикет цепочки); здесь — нативный Nest 404
      // достаточен, единственный вызывающий этот маршрут — apps/worker, не браузер.
      if (error instanceof TicketNotFoundError) {
        throw new NotFoundException(`Support ticket "${ticketId}" not found`)
      }
      throw error
    }
  }
}
