import { Inject, Injectable } from '@nestjs/common'
import { parsePeriod } from './get-funnel.use-case.js'
import {
  ANALYTICS_ORDERS_FACADE_PORT,
  type OrdersFacadePort,
} from '../ports/orders-facade.port.js'
import {
  ANALYTICS_INVENTORY_FACADE_PORT,
  type InventoryFacadePort,
} from '../ports/inventory-facade.port.js'

export interface GetPlatformMetricsInput {
  readonly tenantId: string
  readonly period: string
}

export interface GetPlatformMetricsResult {
  readonly gmvDiram: bigint
  readonly orderCount: number
  readonly averageCheckDiram: bigint
  readonly pickupSlaComplianceRate: number
  readonly deliverySlaComplianceRate: number
  readonly cancellationRate: number
  readonly activePharmaciesSendingDataRate: number
}

@Injectable()
export class GetPlatformMetricsUseCase {
  public constructor(
    @Inject(ANALYTICS_ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort,
    @Inject(ANALYTICS_INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  public async execute(input: GetPlatformMetricsInput): Promise<GetPlatformMetricsResult> {
    const range = parsePeriod(input.period)
    const [gmv, sla, cancellationRate, activePharmaciesSendingDataRate] = await Promise.all([
      this.ordersFacade.getGmvAndAverageCheck(input.tenantId, range),
      this.ordersFacade.getSlaComplianceRates(input.tenantId, range),
      this.ordersFacade.getCancellationRate(input.tenantId, range),
      this.inventoryFacade.getActivePharmaciesSendingDataRate(input.tenantId),
    ])
    return {
      gmvDiram: gmv.gmvDiram,
      orderCount: gmv.orderCount,
      averageCheckDiram: gmv.averageCheckDiram,
      pickupSlaComplianceRate: sla.pickupSlaComplianceRate,
      deliverySlaComplianceRate: sla.deliverySlaComplianceRate,
      cancellationRate,
      activePharmaciesSendingDataRate,
    }
  }
}
