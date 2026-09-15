/**
 * `fetchMyTickets` (DTJ-284) — `GET /api/v1/support-tickets` (DTJ-282). Сервер уже скоупит
 * список по `customer` из RBAC (`ListSupportTicketsUseCase`, `SupportTicketsPolicy.canListAll`)
 * — клиент НЕ передаёт `customerId` явно (ticket «Что сделать» п.4).
 */
import type { SupportTicketDto } from '@dorutj/contracts'
import { httpGetJson } from '@/shared/api/http-client'

const SUPPORT_TICKETS_PATH = '/api/v1/support-tickets'

export function fetchMyTickets(): Promise<readonly SupportTicketDto[]> {
  return httpGetJson<readonly SupportTicketDto[]>(SUPPORT_TICKETS_PATH)
}
