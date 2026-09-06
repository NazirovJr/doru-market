/**
 * `SupportFacade` (EP-14, DTJ-281, SRS-ADM-074) — публичный контракт модуля `support` для
 * ВНЕШНИХ модулей (D-27, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Токен `SUPPORT_FACADE`
 * объявлен `modules/support/index.ts` (DTJ-270, заранее) — форма интерфейса живёт здесь, тот
 * же приём, что `payments/application/ports/payments-facade.port.ts` (DTJ-249): `index.ts`
 * лишь ре-экспортирует тип для внешних потребителей.
 *
 * Три метода:
 * - `createTicket` — человеческие каналы (`in_app`/`telegram_bot`/`phone`). Вызывается
 *   `presentation`-слоем ЭТОГО ЖЕ модуля (DTJ-282) — даже собственный презентационный слой
 *   модуля идёт через фасад, не напрямую к use case (ticket «Что сделать» п.3: единообразие
 *   точки входа).
 * - `createAutoTicket` — системные инициаторы, ДРУГИЕ модули (`DeliveryFacade`/`ReturnsFacade`,
 *   например переадресация `reason='undelivered'` из DTJ-273). `DeliveryFacade` пока не
 *   существует в этом диапазоне тикетов (EP-13, вне периметра) — этот файл реализует ТОЛЬКО
 *   принимающую сторону контракта (см. «Риски» DTJ-281).
 * - `escalateTicketPriority` — используется `EscalateTicketPriorityController` (DTJ-280,
 *   apps/worker → apps/api HTTP-мост), тем же приёмом единообразия точки входа.
 *
 * `SupportTicketSummary` — минимальный DTO для чужих модулей (НЕ полный `SupportTicketDto`
 * presentation-слоя, DTJ-282, `packages/contracts/src/support.ts`) — только то, что реально
 * нужно потребителям: `id`, `status`, `category`.
 */
import type { SupportTicketCategory, SupportTicketChannel, SupportTicketStatus, UserRole } from '@dorutj/contracts'

/** Минимальный DTO тикета для чужих модулей (не путать с полным `SupportTicketDto`, DTJ-282). */
export interface SupportTicketSummary {
  readonly id: string
  readonly status: SupportTicketStatus
  readonly category: SupportTicketCategory
}

export interface CreateSupportTicketFacadeInput {
  readonly tenantId: string
  readonly orderId?: string
  readonly channel: SupportTicketChannel
  /** Не строгий union — тот же приём, что `CreateSupportTicketCommand.category` (DTJ-279):
   *  вызывающий (DTJ-282, HTTP-слой) валидирует по `SupportTicketCategory.parse()` внутри. */
  readonly category: string
  readonly createdBy?: string
  readonly description?: string
  readonly actorRole: UserRole
}

export interface CreateSupportTicketFacadeResult {
  readonly ticketId: string
}

/** `category` — строгий union (не `string`): вызывающие — ДРУГИЕ модули этого же бэкенда
 *  (внутренний типобезопасный вызов), не непроверенный HTTP-ввод, см. `CreateAutoSupportTicketUseCase`. */
export interface CreateAutoSupportTicketFacadeInput {
  readonly tenantId: string
  readonly orderId?: string
  readonly category: SupportTicketCategory
  readonly description?: string
}

export interface EscalateTicketPriorityFacadeResult {
  readonly ticketId: string
  readonly priority: number
}

export interface SupportFacade {
  createTicket(input: CreateSupportTicketFacadeInput): Promise<CreateSupportTicketFacadeResult>
  createAutoTicket(input: CreateAutoSupportTicketFacadeInput): Promise<SupportTicketSummary>
  escalateTicketPriority(ticketId: string): Promise<EscalateTicketPriorityFacadeResult>
}
