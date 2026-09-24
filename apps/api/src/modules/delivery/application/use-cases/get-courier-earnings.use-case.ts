import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, ValidationError, type UserRole } from '@dorutj/contracts'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_EARNINGS_REPOSITORY,
  type CourierEarningRow,
  type CourierEarningsCursor,
  type CourierEarningsRepositoryPort,
} from '../ports/courier-earnings.repository.port.js'

export interface GetCourierEarningsInput {
  readonly role: UserRole
  readonly userId: string
  // игнорируется для role='courier' (implicit own scope), обязателен для super_admin
  readonly filterCourierId: string | null
  readonly limit: number
  readonly cursor: CourierEarningsCursor | null
}

export interface CourierEarningViewDto {
  readonly id: string
  readonly amountDiram: number
  readonly isReturnFee: boolean
  readonly recognizedAt: Date
  readonly payoutBatchId: string | null
}

export interface GetCourierEarningsResult {
  readonly items: readonly CourierEarningViewDto[]
  readonly nextCursor: CourierEarningsCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class GetCourierEarningsUseCase {
  public constructor(
    @Inject(COURIER_EARNINGS_REPOSITORY) private readonly earnings: CourierEarningsRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
  ) {}

  public async execute(input: GetCourierEarningsInput): Promise<GetCourierEarningsResult> {
    const courierId = await this.resolveCourierId(input)
    const page = await this.earnings.findPage({ courierId, limit: input.limit, cursor: input.cursor })
    return { items: page.items.map(toCourierEarningViewDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }

  private async resolveCourierId(input: GetCourierEarningsInput): Promise<string> {
    if (input.role === 'courier') {
      const courier = await this.couriers.findByUserId(input.userId)
      if (courier === null) {
        throw new NotFoundError({ userId: input.userId })
      }
      return courier.id
    }
    if (input.filterCourierId === null || input.filterCourierId.trim() === '') {
      throw new ValidationError('filter[courierId] is required for this role', { field: 'filter[courierId]' })
    }
    if (input.role !== 'super_admin') {
      throw new ForbiddenError('Only courier (own) or super_admin (filtered) may list courier earnings')
    }
    return input.filterCourierId
  }
}

function toCourierEarningViewDto(row: CourierEarningRow): CourierEarningViewDto {
  return {
    id: row.id,
    amountDiram: Number(row.amountDiram),
    isReturnFee: row.isReturnFee,
    recognizedAt: row.recognizedAt,
    payoutBatchId: row.payoutBatchId,
  }
}
