import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_PAYOUTS_REPOSITORY,
  type CourierPayoutRow,
  type CourierPayoutsCursor,
  type CourierPayoutsRepositoryPort,
} from '../ports/courier-payouts.repository.port.js'

export interface GetCourierPayoutsInput {
  readonly role: UserRole
  readonly userId: string
  // в отличие от courier-earnings, здесь фильтр опционален для super_admin (null = все курьеры)
  readonly filterCourierId: string | null
  readonly limit: number
  readonly cursor: CourierPayoutsCursor | null
}

export interface CourierPayoutViewDto {
  readonly id: string
  readonly courierId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly totalAmountDiram: number
  readonly cashRemittanceOffsetDiram: number
  readonly status: 'draft' | 'issued' | 'paid' | 'failed'
  readonly issuedAt: Date | null
  readonly paidAt: Date | null
}

export interface GetCourierPayoutsResult {
  readonly items: readonly CourierPayoutViewDto[]
  readonly nextCursor: CourierPayoutsCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class GetCourierPayoutsUseCase {
  public constructor(
    @Inject(COURIER_PAYOUTS_REPOSITORY) private readonly payouts: CourierPayoutsRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
  ) {}

  public async execute(input: GetCourierPayoutsInput): Promise<GetCourierPayoutsResult> {
    const courierId = await this.resolveCourierId(input)
    const page = await this.payouts.findPage({ courierId, limit: input.limit, cursor: input.cursor })
    return { items: page.items.map(toCourierPayoutViewDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }

  private async resolveCourierId(input: GetCourierPayoutsInput): Promise<string | null> {
    if (input.role === 'courier') {
      const courier = await this.couriers.findByUserId(input.userId)
      if (courier === null) {
        throw new NotFoundError({ userId: input.userId })
      }
      return courier.id
    }
    if (input.role !== 'super_admin') {
      throw new ForbiddenError('Only courier (own) or super_admin (filtered/all) may list courier payouts')
    }
    return input.filterCourierId === null || input.filterCourierId.trim() === '' ? null : input.filterCourierId
  }
}

function toCourierPayoutViewDto(row: CourierPayoutRow): CourierPayoutViewDto {
  return {
    id: row.id,
    courierId: row.courierId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    totalAmountDiram: Number(row.totalAmountDiram),
    cashRemittanceOffsetDiram: Number(row.cashRemittanceOffsetDiram),
    status: row.status,
    issuedAt: row.issuedAt,
    paidAt: row.paidAt,
  }
}
