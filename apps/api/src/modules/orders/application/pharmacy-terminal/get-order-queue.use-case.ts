/**
 * `GetOrderQueueUseCase` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта», SRS-PHT-005/005a/006) —
 * `GET /api/v1/orders?filter[pharmacyId]=<id>&sort=priority&cursor=&limit=20`.
 *
 * Тенант/сеть-скоуп (SRS-API-043/046, SRS-PHT-005a) — ЕДИНСТВЕННАЯ точка резолвинга области
 * видимости (`resolveScope`): `pharmacist` — ВСЕГДА своя аптека (явный `filter[pharmacyId]`,
 * если передан, ОБЯЗАН совпасть с `actor.pharmacyId`, иначе `403` — попытка заглянуть в чужую
 * очередь, не «молча проигнорировать чужой параметр»). `pharmacy_admin` БЕЗ `filter[pharmacyId]`
 * — вся сеть (`actor.chainId`, `meta.groupedBy` присутствует); С `filter[pharmacyId]` — ОДНА
 * аптека, но ОБЯЗАНА принадлежать его сети (иначе `403`) — межсетевая изоляция (TC-PHT-030).
 * `chainId === null` (админ без сети, ASSUMPTION) — область сужается до `actor.pharmacyId`,
 * аналогично `pharmacist`, `meta.groupedBy` не строится (агрегировать нечего).
 *
 * Сортировка — `OrderQueueSortPolicy` (application, НЕ поле БД, SRS-PHT-005). Пагинация —
 * keyset ПОВЕРХ уже отсортированного in-memory массива (не БД `OFFSET`): `OrderQueueRow.
 * itemsCount` — ЕДИНСТВЕННОЕ поле, не входящее ни в один индекс, масштаб MVP — активная очередь
 * ОДНОЙ аптеки/сети (десятки заказов, не история), «Риски» тикета.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, type UserRole } from '@dorutj/contracts'
import {
  ORDER_REPOSITORY_PORT,
  type OrderQueueRow,
  type OrderQueueScope,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { OrderQueueSortPolicy } from './order-queue-sort.policy.js'

/** SRS-PHT-005 — набор статусов, определяющих «очередь терминала» (не клиентский параметр —
 *  семантика ЭТОГО эндпоинта, `filter[status][in]` тикета фиксирован, не варьируется вызывающим). */
const QUEUE_STATUSES = ['paid_escrow', 'confirmed', 'processing'] as const

export interface GetOrderQueueActor {
  readonly role: UserRole
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export interface GetOrderQueueCommand {
  readonly actor: GetOrderQueueActor
  /** `filter[pharmacyId]` — `null`, если не передан клиентом. */
  readonly filterPharmacyId: string | null
  /** Декодированный `cursor.v` (см. `CursorQueryPipe`) — `null` для первой страницы. */
  readonly cursor: string | null
  readonly limit: number
}

export interface GetOrderQueueResult {
  readonly items: readonly OrderQueueRow[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
  /** SRS-PHT-005a — присутствует ТОЛЬКО для агрегированного вида сети `pharmacy_admin`. */
  readonly groupedByPharmacyId: Readonly<Record<string, readonly string[]>> | null
}

@Injectable()
export class GetOrderQueueUseCase {
  constructor(@Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort) {}

  async execute(cmd: GetOrderQueueCommand): Promise<GetOrderQueueResult> {
    const scope = await this.resolveScope(cmd)
    const rows = await this.orderRepository.findQueueOrders({
      tenantId: cmd.actor.tenantId,
      scope,
      statuses: QUEUE_STATUSES,
    })
    const sorted = OrderQueueSortPolicy.sort(rows)
    const page = paginate(sorted, cmd.cursor, cmd.limit)
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      groupedByPharmacyId: scope.kind === 'chain' ? buildGroupedByPharmacyId(page.items) : null,
    }
  }

  /** См. JSDoc файла — единственная точка резолвинга области видимости. */
  private async resolveScope(cmd: GetOrderQueueCommand): Promise<OrderQueueScope> {
    const { actor, filterPharmacyId } = cmd
    if (actor.role !== 'pharmacy_admin') {
      return this.resolveSinglePharmacyScope(actor.pharmacyId, filterPharmacyId)
    }
    if (filterPharmacyId !== null) {
      await this.assertPharmacyInAdminNetwork(actor, filterPharmacyId)
      return { kind: 'pharmacy', pharmacyId: filterPharmacyId }
    }
    if (actor.chainId === null) {
      // ASSUMPTION (см. JSDoc файла) — админ без сети сужается до своей единственной аптеки.
      return this.resolveSinglePharmacyScope(actor.pharmacyId, null)
    }
    return { kind: 'chain', chainId: actor.chainId }
  }

  /** `pharmacist` (и `pharmacy_admin` без сети) — ВСЕГДА своя аптека, явный чужой `filterPharmacyId` → 403. */
  private resolveSinglePharmacyScope(ownPharmacyId: string | null, filterPharmacyId: string | null): OrderQueueScope {
    if (ownPharmacyId === null) {
      throw new ForbiddenError('Actor has no pharmacy assigned — cannot resolve terminal queue scope', {})
    }
    if (filterPharmacyId !== null && filterPharmacyId !== ownPharmacyId) {
      throw new ForbiddenError('filter[pharmacyId] does not match the requesting pharmacist/admin own pharmacy', {
        filterPharmacyId,
      })
    }
    return { kind: 'pharmacy', pharmacyId: ownPharmacyId }
  }

  /** SRS-PHT-005a (TC-PHT-030) — межсетевая изоляция: явный `filterPharmacyId` обязан принадлежать сети актора. */
  private async assertPharmacyInAdminNetwork(actor: GetOrderQueueActor, filterPharmacyId: string): Promise<void> {
    if (actor.chainId === null) {
      if (filterPharmacyId !== actor.pharmacyId) {
        throw new ForbiddenError('filter[pharmacyId] is outside the requesting pharmacy_admin scope', { filterPharmacyId })
      }
      return
    }
    const networkPharmacyIds = await this.orderRepository.findPharmacyIdsByChain(actor.tenantId, actor.chainId)
    if (!networkPharmacyIds.includes(filterPharmacyId)) {
      throw new ForbiddenError('filter[pharmacyId] is outside the requesting pharmacy_admin network (chainId)', {
        filterPharmacyId,
      })
    }
  }
}

interface Page {
  readonly items: readonly OrderQueueRow[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

/** Keyset-пагинация поверх уже отсортированного массива (см. JSDoc файла). */
function paginate(sorted: readonly OrderQueueRow[], cursor: string | null, limit: number): Page {
  const startIndex =
    cursor === null ? 0 : findFirstIndexAfterCursor(sorted, cursor)
  const window = sorted.slice(startIndex, startIndex + limit + 1)
  const hasMore = window.length > limit
  const items = window.slice(0, limit)
  const lastItem = items[items.length - 1]
  const nextCursor = hasMore && lastItem !== undefined ? OrderQueueSortPolicy.cursorValue(lastItem) : null
  return { items, nextCursor, hasMore }
}

/** Первая строка, чей `cursorValue` СТРОГО больше курсора — `sorted.length`, если ни одной (конец списка). */
function findFirstIndexAfterCursor(sorted: readonly OrderQueueRow[], cursor: string): number {
  const index = sorted.findIndex((row) => OrderQueueSortPolicy.cursorValue(row) > cursor)
  return index === -1 ? sorted.length : index
}

/** SRS-PHT-005a — `{ pharmacyId: orderId[] }`, порядок id — тот же, что в `items` (см. JSDoc контракта). */
function buildGroupedByPharmacyId(items: readonly OrderQueueRow[]): Readonly<Record<string, readonly string[]>> {
  const byPharmacy = new Map<string, string[]>()
  for (const item of items) {
    const existing = byPharmacy.get(item.pharmacyId)
    if (existing === undefined) {
      byPharmacy.set(item.pharmacyId, [item.id])
    } else {
      existing.push(item.id)
    }
  }
  return Object.fromEntries(byPharmacy)
}
