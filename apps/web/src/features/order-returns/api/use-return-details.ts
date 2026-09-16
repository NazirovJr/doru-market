import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { OrderReturnDto, ReturnStatus } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

/**
 * `useReturnDetails` (DTJ-276, EP-11, «Что сделать» п.2) — TanStack Query запрос
 * `GET /api/v1/order-returns/:id` (DTJ-275) с `refetchInterval` для отслеживания смены статуса,
 * пока возврат не в ТЕРМИНАЛЬНОМ статусе.
 *
 * **Терминален ТОЛЬКО `return_confirmed`.** `return_rejected` — НЕ терминален (SRS-DOM-056,
 * `order-return.state-machine.ts`: `adminOverride()` → `return_confirmed`, `retryTransit()` →
 * `return_in_transit` — оба перехода возможны ИЗ `return_rejected`) — поллинг продолжается
 * (тикет «Что сделать» п.2, буквально).
 *
 * `RETURN_STATUS_POLL_INTERVAL_MS` не зафиксирован ни одной SRS-спекой (проверено — «Риски»
 * тикета конкретного значения не называют) — выбран консервативный дефолт 10с, тот же порядок
 * величины, что серверный `OUTBOX_POLL_INTERVAL_MS` (`apps/worker/.../outbox-relay.constants.ts`,
 * 2с — там фоновая джоба, не открытый клиентский экран, здесь заведомо выше, чтобы не
 * бомбардировать API, пока пользователь просто держит вкладку открытой), ASSUMPTION.
 *
 * `resolveReturnDetailsRefetchInterval` вынесена отдельно (не инлайн в `refetchInterval`) —
 * чистая функция, тестируется напрямую без необходимости симулировать реальные таймеры/сеть.
 */
const ORDER_RETURNS_PATH = '/api/v1/order-returns'
const RETURN_STATUS_POLL_INTERVAL_MS = 10_000
const TERMINAL_RETURN_STATUSES: ReadonlySet<ReturnStatus> = new Set(['return_confirmed'])

function fetchReturnDetails(returnId: string): Promise<OrderReturnDto> {
  return httpGetJson<OrderReturnDto>(`${ORDER_RETURNS_PATH}/${returnId}`)
}

export function returnDetailsQueryKey(returnId: string): readonly [string, string] {
  return ['order-returns', returnId] as const
}

export function resolveReturnDetailsRefetchInterval(status: ReturnStatus | undefined): number | false {
  if (status === undefined) {
    return RETURN_STATUS_POLL_INTERVAL_MS
  }
  return TERMINAL_RETURN_STATUSES.has(status) ? false : RETURN_STATUS_POLL_INTERVAL_MS
}

export function useReturnDetails(returnId: string): UseQueryResult<OrderReturnDto, HttpError> {
  return useQuery<OrderReturnDto, HttpError>({
    queryKey: returnDetailsQueryKey(returnId),
    queryFn: () => fetchReturnDetails(returnId),
    refetchInterval: (query) => resolveReturnDetailsRefetchInterval(query.state.data?.status),
  })
}
