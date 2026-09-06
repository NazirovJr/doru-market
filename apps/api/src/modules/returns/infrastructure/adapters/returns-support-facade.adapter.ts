/**
 * `ReturnsSupportFacadeAdapter` (EP-11, DTJ-273) — реализация `ReturnsSupportFacadePort` через
 * тонкую обёртку поверх публичного `SupportFacade` (`modules/support/index.ts`, забинжен этим же
 * тикетом). Межмодульный вызов ИСКЛЮЧИТЕЛЬНО через публичный фасад (`02` §1.2) — не через
 * `modules/support/application/**` напрямую.
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
    return this.supportFacade.createAutoOrManualTicket(command)
  }
}

export const RETURNS_SUPPORT_FACADE_PROVIDER = {
  provide: RETURNS_SUPPORT_FACADE_PORT,
  useClass: ReturnsSupportFacadeAdapter,
} as const
