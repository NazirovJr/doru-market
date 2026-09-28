// Узкий порт orders → payments (02 §1.2/1.3) — только метод, нужный TenancyFacadeAdapter.resolveCommissionRate (DTJ-358).
export const ORDERS_PAYMENTS_FACADE_PORT = Symbol.for('@dorutj/orders/payments-facade-port')

export interface OrdersPaymentsFacadePort {
  resolveCommissionRate(tenantId: string, chainId: string | null, category: string): Promise<number | null>
}
