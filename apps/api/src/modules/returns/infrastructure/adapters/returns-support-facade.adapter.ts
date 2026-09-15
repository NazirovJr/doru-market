/**
 * `ReturnsSupportFacadeAdapter` (EP-11, DTJ-273) — реализация `ReturnsSupportFacadePort` через
 * тонкую обёртку поверх публичного `SupportFacade` (`modules/support/index.ts`, забинжен
 * `SupportModule`, DTJ-281). Межмодульный вызов ИСКЛЮЧИТЕЛЬНО через публичный фасад (`02` §1.2) —
 * не через `modules/support/application/**` напрямую.
 *
 * ПРАВЛЕНО при слиянии `feat/ep-11-returns-flow` в `development`: изначально эта ветка сама
 * объявляла временный метод `SupportFacade.createAutoOrManualTicket` (первой из двух параллельных
 * веток, добававших первый провайдер `SUPPORT_FACADE`). К моменту слияния `SupportFacade` уже
 * реализован полностью (DTJ-281, независимо верифицирован) под методом `createAutoTicket` — этот
 * адаптер переведён на реальную сигнатуру. `channel`/`createdBy`/`actorRole` из
 * `ReturnsCreateSupportTicketCommand` не входят в `CreateAutoSupportTicketFacadeInput` — это
 * системный, не ручной канал создания тикета (см. JSDoc `support-facade.port.ts`), поля осознанно
 * не прокидываются.
 */
import { Inject, Injectable } from '@nestjs/common'
import { SUPPORT_FACADE, type SupportFacade } from '@/modules/support/index.js'
import {
  RETURNS_SUPPORT_FACADE_PORT,
  type ReturnsCreateSupportTicketCommand,
  type ReturnsSupportFacadePort,
} from '@/modules/returns/application/ports/returns-support-facade.port.js'

@Injectable()
export class ReturnsSupportFacadeAdapter implements ReturnsSupportFacadePort {
  public constructor(@Inject(SUPPORT_FACADE) private readonly supportFacade: SupportFacade) {}

  public async createAutoOrManualTicket(command: ReturnsCreateSupportTicketCommand): Promise<{ readonly ticketId: string }> {
    const summary = await this.supportFacade.createAutoTicket({
      tenantId: command.tenantId,
      orderId: command.orderId,
      category: command.category,
    })
    return { ticketId: summary.id }
  }
}

export const RETURNS_SUPPORT_FACADE_PROVIDER = {
  provide: RETURNS_SUPPORT_FACADE_PORT,
  useClass: ReturnsSupportFacadeAdapter,
} as const
