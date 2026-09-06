/**
 * `useSupportTickets` (DTJ-283) — TanStack Query список тикетов (`GET /api/v1/support-tickets`,
 * DTJ-282). Фильтры `status`/`category` синхронизированы с query-параметрами URL (react-router
 * `useSearchParams`, ticket «Что сделать» п.1) — отфильтрованный вид шарабелен между сотрудниками
 * поддержки. `messages` сервер отдаёт `[]` для этого эндпоинта (см. JSDoc `SupportTicketDto`) —
 * очередь их не показывает, деталь (`use-support-ticket-detail.ts`) — отдельный запрос.
 *
 * «Только просроченные» — НЕ параметр этого хука: клиентский фильтр (`model/sla-status.ts`),
 * вычисляется в `SupportTicketQueue.tsx` поверх уже загруженной страницы (ticket «Что сделать» п.2,
 * «сервер уже отдаёт нужные поля, доп. эндпоинт не нужен»).
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SupportTicketCategory, SupportTicketDto, SupportTicketStatus } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

const SUPPORT_TICKETS_PATH = '/api/v1/support-tickets'
/** Волна 1 — без пагинации в UI (ticket не требует "load more", очередь одного тенанта невелика,
 *  тот же class упрощения, что `httpRequest` без auth-retry в этом приложении, DTJ-075). */
const LIST_LIMIT = '100'

export interface SupportTicketsFilters {
  readonly status: SupportTicketStatus | undefined
  readonly category: SupportTicketCategory | undefined
}

function readFilters(searchParams: URLSearchParams): SupportTicketsFilters {
  return {
    status: (searchParams.get('status') ?? undefined) as SupportTicketStatus | undefined,
    category: (searchParams.get('category') ?? undefined) as SupportTicketCategory | undefined,
  }
}

export interface UseSupportTicketsResult {
  readonly query: UseQueryResult<readonly SupportTicketDto[], HttpError>
  readonly filters: SupportTicketsFilters
  readonly setFilter: (key: keyof SupportTicketsFilters, value: string | undefined) => void
}

export function useSupportTickets(): UseSupportTicketsResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readFilters(searchParams), [searchParams])

  const query = useQuery<readonly SupportTicketDto[], HttpError>({
    queryKey: ['admin', 'support-tickets', 'list', filters.status, filters.category],
    queryFn: () =>
      httpGetJson<readonly SupportTicketDto[]>(SUPPORT_TICKETS_PATH, {
        limit: LIST_LIMIT,
        status: filters.status,
        category: filters.category,
      }),
  })

  const setFilter = useCallback(
    (key: keyof SupportTicketsFilters, value: string | undefined): void => {
      const next = new URLSearchParams(searchParams)
      if (value === undefined || value.length === 0) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  return { query, filters, setFilter }
}
