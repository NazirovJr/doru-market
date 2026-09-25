// Узкий порт analytics → orders, независимый от admin's ORDERS_FACADE_PORT — оба биндятся на один OrdersFacade через useExisting.
export const ANALYTICS_ORDERS_FACADE_PORT = Symbol.for('@dorutj/analytics/orders-facade-port')

export interface AnalyticsOrdersPeriod {
  readonly start: Date
  readonly end: Date
}

export interface GmvAndAverageCheck {
  readonly gmvDiram: bigint
  readonly orderCount: number
  readonly averageCheckDiram: bigint
}

export interface SlaComplianceRates {
  readonly pickupSlaComplianceRate: number
  readonly deliverySlaComplianceRate: number
}

export interface OrdersFacadePort {
  getGmvAndAverageCheck(tenantId: string, period: AnalyticsOrdersPeriod): Promise<GmvAndAverageCheck>
  getSlaComplianceRates(tenantId: string, period: AnalyticsOrdersPeriod): Promise<SlaComplianceRates>
  getCancellationRate(tenantId: string, period: AnalyticsOrdersPeriod): Promise<number>
}
