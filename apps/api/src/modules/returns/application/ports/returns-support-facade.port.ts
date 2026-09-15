/**
 * Порт `ReturnsSupportFacadePort` (EP-11, DTJ-273, SRS-RET-003). Межмодульный фасад
 * `returns → support` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) — ЕДИНСТВЕННЫЙ способ, которым
 * `RequestReturnUseCase` переадресует `reason='undelivered'` в обращение, не создавая `OrderReturn`
 * (SRS-RET-003). Файл СВЕРХ буквального `files_owned` (та же причина, что соседние порты этого
 * каталога) — тонкая обёртка поверх публичного `SupportFacade` (`modules/support/index.ts`),
 * 1:1 приём, что `SupportOrdersFacadePort` оборачивает `orders` для `support` (симметрично).
 */
import type { SupportTicketCategory, SupportTicketChannel, UserRole } from '@dorutj/contracts'

export const RETURNS_SUPPORT_FACADE_PORT = Symbol.for('@dorutj/returns/support-facade')

export interface ReturnsCreateSupportTicketCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  readonly createdBy: string
  readonly actorRole: UserRole
}

export interface ReturnsSupportFacadePort {
  createAutoOrManualTicket(command: ReturnsCreateSupportTicketCommand): Promise<{ readonly ticketId: string }>
}
