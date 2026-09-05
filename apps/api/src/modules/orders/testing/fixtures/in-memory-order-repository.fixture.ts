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
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type {
  LockedOrderRow,
  OrderQueueQuery,
  OrderQueueRow,
  OrderRepositoryPort,
  OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'

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
