/**
 * `InMemoryOrderRepository` (EP-09, DTJ-222) — фикстура `OrderRepositoryPort` для unit-тестов
 * `OrdersFacade`. НЕ используется в боевой проводке (`orders.module.ts` биндит `ORDER_REPOSITORY_PORT`
 * на `UnimplementedOrderRepositoryAdapter` до появления Drizzle-репозитория, правило 3 AGENTS.md).
 */
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderRepositoryPort } from '@/modules/orders/application/ports/order-repository.port.js'

export class InMemoryOrderRepository implements OrderRepositoryPort {
  private readonly orders = new Map<string, Order>()

  seed(order: Order): void {
    this.orders.set(order.id, order)
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
}
