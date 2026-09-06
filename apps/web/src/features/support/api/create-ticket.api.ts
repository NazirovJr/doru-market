/**
 * `createTicket` (DTJ-284) — `POST /api/v1/support-tickets` (DTJ-282). `channel='in_app'`
 * ВСЕГДА (ticket «Что сделать» п.1) — единственный канал, доступный клиенту через `apps/web`
 * (`telegram_bot`/`phone`/`system_auto` — другие входные точки того же API, вне периметра этого
 * тикета). `orderId` — опционален (форма без заказа, п.2 «общий канал обращения»).
 */
import type { SupportTicketCategory, SupportTicketDto } from '@dorutj/contracts'
import { httpPostJson } from '@/shared/api/http-client'

const SUPPORT_TICKETS_PATH = '/api/v1/support-tickets'
const CHANNEL = 'in_app'

export interface CreateTicketInput {
  readonly category: SupportTicketCategory
  readonly description: string
  readonly orderId?: string
}

interface CreateTicketRequestBody {
  readonly channel: 'in_app'
  readonly category: SupportTicketCategory
  readonly description: string
  readonly orderId?: string
}

export function createTicket(input: CreateTicketInput): Promise<SupportTicketDto> {
  const body: CreateTicketRequestBody = {
    channel: CHANNEL,
    category: input.category,
    description: input.description,
    // `exactOptionalPropertyTypes` — `orderId` включается, ТОЛЬКО когда задан.
    ...(input.orderId !== undefined && { orderId: input.orderId }),
  }
  return httpPostJson<SupportTicketDto>(SUPPORT_TICKETS_PATH, body)
}
