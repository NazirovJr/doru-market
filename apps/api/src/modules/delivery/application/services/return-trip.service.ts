import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { BuildCourierCandidateQueryService, type AssignmentContext } from './build-courier-candidate-query.service.js'
import { CalculateDeliveryFeeUseCase } from '../use-cases/calculate-delivery-fee.use-case.js'
import { SuggestNearestCourierUseCase } from '../use-cases/suggest-nearest-courier.use-case.js'

export interface ReturnTripInput {
  readonly tenantId: string
  readonly orderId: string
}

export interface ReturnCourierAssignment {
  readonly courierId: string
  readonly etaMinutes: number | null
}

@Injectable()
export class ReturnTripService {
  public constructor(
    @Inject(BuildCourierCandidateQueryService) private readonly buildQuery: BuildCourierCandidateQueryService,
    @Inject(SuggestNearestCourierUseCase) private readonly suggestCourier: SuggestNearestCourierUseCase,
    @Inject(CalculateDeliveryFeeUseCase) private readonly calculateFee: CalculateDeliveryFeeUseCase,
  ) {}

  // Заказ без координат клиента тарифицируется по нулевой дистанции — только базовая ставка.
  public async calculateReturnFee(input: ReturnTripInput): Promise<bigint> {
    const { order, pharmacy } = await this.loadContext(input)
    return this.calculateFee.executeForReturn({
      tenantId: input.tenantId,
      pharmacyGeoPoint: pharmacy.geoPoint,
      customerGeoPoint: order.deliveryGeoPoint ?? pharmacy.geoPoint,
    })
  }

  public async suggestReturnCourier(input: ReturnTripInput): Promise<ReturnCourierAssignment | null> {
    const { candidateQuery } = await this.loadContext(input)
    const [best] = await this.suggestCourier.execute(candidateQuery)
    return best === undefined ? null : { courierId: best.courierId, etaMinutes: null }
  }

  private async loadContext(input: ReturnTripInput): Promise<AssignmentContext> {
    const context = await this.buildQuery.execute(input.orderId)
    if (context.order.tenantId !== input.tenantId) {
      throw new NotFoundError({ resource: 'order', orderId: input.orderId })
    }
    return context
  }
}
