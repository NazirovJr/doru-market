import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { httpRequestJson } from '@/shared/api/http-client'

/**
 * `use-incoming-returns.ts` (DTJ-277, EP-11, SRS-RET-011) — очередь возвратов своей аптеки:
 * `return_in_transit` (едут) + `return_rejected` (ожидают повторной попытки/эскалации,
 * SRS-DOM-056 — не терминальный статус). Компоновка списка — аналог `/admin/order-queue`
 * (`GetOrderQueueUseCase`, EP-12, `GET /api/v1/orders?filter[pharmacyId]=...`), но БИЗНЕС-логика
 * своя (DTJ-277 «Что сделать» п.1: «переиспользовать компоновку списка, не бизнес-логику»).
 *
 * ВАЖНО (риск, зафиксировать при сдаче тикета): `GET /api/v1/order-returns` (список) физически
 * ОТСУТСТВУЕТ в REST API возвратов на момент реализации — `OrderReturnsController` (DTJ-275,
 * уже смёржен) реализует ровно 7 эндпоинтов из `21-module-orders-payments-escrow.md` §7.5
 * (строки 1035-1041): `POST /`, 5×`POST /:id/...`, `GET /:id` — БЕЗ коллекционного `GET /`.
 * Эндпоинт ниже спроектирован по аналогии с `filter[status][in]` (`SRS-API-007`) и остаётся вне
 * `files_owned` DTJ-277 (правки `apps/api/src/modules/returns/**` принадлежат DTJ-275) — нужен
 * последующий PR, добавляющий `GET /api/v1/order-returns` в контроллер/репозиторий возвратов.
 * До этого хук рабочий (типы/тесты/UI готовы), но реальный бэкенд ответит `404`.
 *
 * `pharmacyId` НЕ передаётся параметром (DTJ-277 критерий приёмки 4) — скоуп «своя аптека»
 * резолвится на сервере из JWT (`Authorization`-заголовок, `http-client.ts`), тот же приём, что
 * все остальные эндпоинты `order-returns` (RBAC "два слоя", `OrderReturnsController` JSDoc).
 */

const INCOMING_RETURN_STATUSES = ['return_in_transit', 'return_rejected'] as const

export const INCOMING_RETURNS_QUERY_KEY = ['returns', 'incoming'] as const

export const INCOMING_RETURNS_PATH = `/api/v1/order-returns?filter[status][in]=${INCOMING_RETURN_STATUSES.join(',')}`

interface IncomingReturnsResponse {
  readonly items: readonly OrderReturnDto[]
}

export interface IncomingReturnsResult {
  readonly inTransit: readonly OrderReturnDto[]
  readonly rejected: readonly OrderReturnDto[]
}

function groupByStatus(items: readonly OrderReturnDto[]): IncomingReturnsResult {
  return {
    inTransit: items.filter((item) => item.status === 'return_in_transit'),
    rejected: items.filter((item) => item.status === 'return_rejected'),
  }
}

export function useIncomingReturns(): UseQueryResult<IncomingReturnsResult> {
  return useQuery({
    queryKey: INCOMING_RETURNS_QUERY_KEY,
    queryFn: async (): Promise<IncomingReturnsResult> => {
      const response = await httpRequestJson<IncomingReturnsResponse>(INCOMING_RETURNS_PATH)
      return groupByStatus(response.items)
    },
  })
}
