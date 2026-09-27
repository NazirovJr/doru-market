/**
 * `InMemoryOrderRepository` (EP-09, DTJ-222) — фикстура `OrderRepositoryPort` для unit-тестов
 * `OrdersFacade`. НЕ используется в боевой проводке (`orders.module.ts` биндит `ORDER_REPOSITORY_PORT`
 * на `UnimplementedOrderRepositoryAdapter` до появления Drizzle-репозитория, правило 3 AGENTS.md).
 *
 * РАСШИРЕНИЕ (DTJ-301, EP-12) — `assignedPharmacistId`/`assignedPharmacistName` держатся ОТДЕЛЬНОЙ
 * `Map` (не полем `Order`, см. JSDoc `order-repository.port.ts` — колонка вне домена). `seed()`
 * принимает необязательный 2-й аргумент, чтобы тесты `accept`/`reclaim` могли посеять заказ уже
 * «в работе у X» без похода в реальную БД. `findPharmacyIdsByChain`/`findQueueOrders` — плоский
 * перебор `orders`, никакого JOIN/SQL (фикстура, не Drizzle).
 */
import type { OrderStatus } from '@dorutj/contracts'
import type { Order, OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type {
  LockedOrderRow,
  OrderAdminSummaryRow,
  OrderCancellationAggregate,
  OrderGmvAggregate,
  OrderMetricsPeriod,
  OrdersAnySearchFilter,
  OrdersAnySearchPage,
  OrdersAnySearchPagination,
  OrderQueueQuery,
  OrderQueueRow,
  OrderRepositoryPort,
  OrderSlaAggregate,
  OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'

const MS_PER_MINUTE = 60_000

function inPeriod(date: Date | null, period: OrderMetricsPeriod): boolean {
  return date !== null && date >= period.start && date < period.end
}

interface SlaOutcome {
  readonly eligible: 0 | 1
  readonly met: 0 | 1
}

const NOT_ELIGIBLE: SlaOutcome = { eligible: 0, met: 0 }

// Вынесено из getSlaAggregate ради max-complexity — чистые функции (no-param-reassign).
function pickupSlaOutcome(s: OrderSnapshot, period: OrderMetricsPeriod): SlaOutcome {
  if (!inPeriod(s.pickedUpAt, period)) return NOT_ELIGIBLE
  const met = s.slaDeadlineAt !== null && s.pickedUpAt !== null && s.pickedUpAt <= s.slaDeadlineAt
  return { eligible: 1, met: met ? 1 : 0 }
}

interface DeliverySlaInput {
  readonly period: OrderMetricsPeriod
  readonly deliverySlaMs: number
}

function deliverySlaOutcome(s: OrderSnapshot, input: DeliverySlaInput): SlaOutcome {
  if (!inPeriod(s.deliveredAt, input.period) || s.pickedUpAt === null) return NOT_ELIGIBLE
  const met = s.deliveredAt !== null && s.deliveredAt.getTime() - s.pickedUpAt.getTime() <= input.deliverySlaMs
  return { eligible: 1, met: met ? 1 : 0 }
}

interface AssignedPharmacist {
  readonly id: string
  readonly name: string | null
}

export class InMemoryOrderRepository implements OrderRepositoryPort {
  private readonly orders = new Map<string, Order>()
  private readonly assignedPharmacists = new Map<string, AssignedPharmacist>()
  /** `pharmacyId → chainId` — посев для `findPharmacyIdsByChain` (DTJ-301, SRS-PHT-005a). */
  private readonly pharmacyChains = new Map<string, string>()

  seed(order: Order, assignedPharmacist: AssignedPharmacist | null = null): void {
    this.orders.set(order.id, order)
    if (assignedPharmacist === null) {
      this.assignedPharmacists.delete(order.id)
    } else {
      this.assignedPharmacists.set(order.id, assignedPharmacist)
    }
  }

  /** DTJ-301 — посев принадлежности аптеки к сети, для `findPharmacyIdsByChain`. */
  seedPharmacyChain(pharmacyId: string, chainId: string): void {
    this.pharmacyChains.set(pharmacyId, chainId)
  }

  findById(tenantId: string, orderId: string): Promise<Order | null> {
    const found = this.orders.get(orderId)
    return Promise.resolve(found?.tenantId === tenantId ? found : null)
  }

  findByCheckoutAttemptId(tenantId: string, checkoutAttemptId: string): Promise<Order | null> {
    const found = [...this.orders.values()].find(
      (order) => order.checkoutAttemptId === checkoutAttemptId && order.tenantId === tenantId,
    )
    return Promise.resolve(found ?? null)
  }

  findByIdAcrossTenants(orderId: string): Promise<Order | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null)
  }

  save(order: Order): Promise<void> {
    this.orders.set(order.id, order) // upsert (правило 6 волны 5 — не голый UPDATE)
    return Promise.resolve()
  }

  findByIdForUpdate(tenantId: string, orderId: string, _tx: OrderUnitOfWorkTx): Promise<LockedOrderRow | null> {
    const order = this.orders.get(orderId)
    if (order?.tenantId !== tenantId) return Promise.resolve(null)
    return Promise.resolve({ order, assignedPharmacistId: this.assignedPharmacists.get(orderId)?.id ?? null })
  }

  setAssignedPharmacist(orderId: string, pharmacistId: string, _tx: OrderUnitOfWorkTx): Promise<void> {
    const existing = this.assignedPharmacists.get(orderId);
    this.assignedPharmacists.set(orderId, { id: pharmacistId, name: existing?.id === pharmacistId ? existing.name : null })
    return Promise.resolve()
  }

  findAssignedPharmacistName(pharmacistId: string): Promise<string | null> {
    const found = [...this.assignedPharmacists.values()].find((p) => p.id === pharmacistId)
    return Promise.resolve(found?.name ?? null)
  }

  findPharmacyIdsByChain(_tenantId: string, chainId: string): Promise<readonly string[]> {
    const ids = [...this.pharmacyChains.entries()].filter(([, c]) => c === chainId).map(([pharmacyId]) => pharmacyId)
    return Promise.resolve(ids)
  }

  findQueueOrders(query: OrderQueueQuery): Promise<readonly OrderQueueRow[]> {
    const scope = query.scope
    const pharmacyIds =
      scope.kind === 'pharmacy'
        ? [scope.pharmacyId]
        : [...this.pharmacyChains.entries()].filter(([, chainId]) => chainId === scope.chainId).map(([pharmacyId]) => pharmacyId)
    const statuses = new Set<OrderStatus>(query.statuses)
    const rows = [...this.orders.values()]
      .filter((order) => order.tenantId === query.tenantId && pharmacyIds.includes(order.pharmacyId) && statuses.has(order.status))
      .map((order) => this.toQueueRow(order))
    return Promise.resolve(rows)
  }

  getGmvAggregate(tenantId: string, period: OrderMetricsPeriod): Promise<OrderGmvAggregate> {
    const delivered = [...this.orders.values()].filter((o) => {
      const s = o.toSnapshot()
      return o.tenantId === tenantId && o.status === 'delivered' && inPeriod(s.deliveredAt, period)
    })
    const gmvDiram = delivered.reduce((sum, o) => sum + o.totalAmount.diram, 0n)
    return Promise.resolve({ gmvDiram, orderCount: delivered.length })
  }

  getSlaAggregate(tenantId: string, period: OrderMetricsPeriod, deliverySlaMinutes: number): Promise<OrderSlaAggregate> {
    const deliverySlaMs = deliverySlaMinutes * MS_PER_MINUTE
    let pickupEligibleCount = 0
    let pickupMetCount = 0
    let deliveryEligibleCount = 0
    let deliveryMetCount = 0
    for (const order of this.orders.values()) {
      if (order.tenantId !== tenantId) continue
      const s = order.toSnapshot()
      const pickup = pickupSlaOutcome(s, period)
      pickupEligibleCount += pickup.eligible
      pickupMetCount += pickup.met
      const delivery = deliverySlaOutcome(s, { period, deliverySlaMs })
      deliveryEligibleCount += delivery.eligible
      deliveryMetCount += delivery.met
    }
    return Promise.resolve({ pickupEligibleCount, pickupMetCount, deliveryEligibleCount, deliveryMetCount })
  }

  getCancellationAggregate(tenantId: string, period: OrderMetricsPeriod): Promise<OrderCancellationAggregate> {
    const inTenantAndPeriod = [...this.orders.values()].filter(
      (o) => o.tenantId === tenantId && o.createdAt >= period.start && o.createdAt < period.end,
    )
    const cancelledCount = inTenantAndPeriod.filter((o) => o.status === 'cancelled').length
    return Promise.resolve({ totalCount: inTenantAndPeriod.length, cancelledCount })
  }

  // Плоский фильтр в памяти, без курсора — тот же уровень упрощения, что findQueueOrders выше.
  findOrdersAny(filter: OrdersAnySearchFilter, pagination: OrdersAnySearchPagination): Promise<OrdersAnySearchPage> {
    const items = [...this.orders.values()]
      .filter((order) => this.matchesOrdersAnyFilter(order, filter))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, pagination.limit)
      .map((order): OrderAdminSummaryRow => ({
        id: order.id,
        orderNumber: order.orderNumber.value,
        status: order.status,
        tenantId: order.tenantId,
        pharmacyId: order.pharmacyId,
        customerId: order.customerId,
        paymentMethod: order.paymentMethod,
        totalAmountDiram: Number(order.totalAmount.diram),
        slaBreached: this.isSlaBreached(order),
        createdAt: order.createdAt,
      }))
    return Promise.resolve({ items, nextCursor: null, hasMore: false })
  }

  private isSlaBreached(order: Order): boolean {
    const slaDeadlineAt = order.toSnapshot().slaDeadlineAt
    return order.status === 'processing' && slaDeadlineAt !== null && slaDeadlineAt.getTime() < Date.now()
  }

  private matchesOrdersAnyFilter(order: Order, filter: OrdersAnySearchFilter): boolean {
    return (
      this.matchesOrdersAnyIdentity(order, filter) && this.matchesOrdersAnyScope(order, filter) && this.matchesOrdersAnyRange(order, filter)
    )
  }

  private matchesOrdersAnyIdentity(order: Order, filter: OrdersAnySearchFilter): boolean {
    if (filter.orderNumberLike !== undefined && !order.orderNumber.value.includes(filter.orderNumberLike)) return false
    if (filter.status !== undefined && order.status !== filter.status) return false
    if (filter.customerId !== undefined && order.customerId !== filter.customerId) return false
    return true
  }

  private matchesOrdersAnyScope(order: Order, filter: OrdersAnySearchFilter): boolean {
    if (filter.tenantId !== undefined && order.tenantId !== filter.tenantId) return false
    if (filter.pharmacyId !== undefined && order.pharmacyId !== filter.pharmacyId) return false
    if (filter.chainId !== undefined && this.pharmacyChains.get(order.pharmacyId) !== filter.chainId) return false
    return true
  }

  private matchesOrdersAnyRange(order: Order, filter: OrdersAnySearchFilter): boolean {
    if (filter.createdAtFrom !== undefined && order.createdAt < filter.createdAtFrom) return false
    if (filter.createdAtTo !== undefined && order.createdAt >= filter.createdAtTo) return false
    if (filter.slaBreached === true && !this.isSlaBreached(order)) return false
    return true
  }

  private toQueueRow(order: Order): OrderQueueRow {
    const snapshot = order.toSnapshot()
    const assigned = this.assignedPharmacists.get(order.id) ?? null
    return {
      id: order.id,
      orderNumber: order.orderNumber.value,
      status: order.status,
      pharmacyId: order.pharmacyId,
      itemsCount: order.items.length,
      itemsTotalTjs: Number(order.itemsTotal.toDbDecimalTjs()),
      paymentMethod: order.paymentMethod,
      prescriptionRequired: snapshot.prescriptionId !== null,
      slaDeadlineAt: snapshot.slaDeadlineAt,
      assignedPharmacistId: assigned?.id ?? null,
      assignedPharmacistName: assigned?.name ?? null,
      createdAt: order.createdAt,
    }
  }
}
