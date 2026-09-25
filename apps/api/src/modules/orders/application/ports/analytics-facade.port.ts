// Межмодульный фасад orders → analytics — прямой импорт modules/analytics/** из orders запрещён.
export const ANALYTICS_FACADE_PORT = Symbol.for('@dorutj/orders/analytics-facade')

export interface AnalyticsOrderPlacedItem {
  readonly medicineId: string
}

export interface RecordOrderPlacedCommand {
  readonly tenantId: string
  // Клиентский телеметрийный sessionId (не auth-сессия, не cart-токен) — опционален.
  readonly sessionId: string | null
  readonly orderId: string
  readonly orderItems: readonly AnalyticsOrderPlacedItem[]
}

export interface AnalyticsFacadePort {
  recordOrderPlaced(command: RecordOrderPlacedCommand): Promise<void>
}
