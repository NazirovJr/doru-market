/**
 * `GetCourierPayoutsUseCase` (EP-13, DTJ-321, SRS-DELIV-031) — `GET /api/v1/courier-payouts`.
 * Файл СВЕРХ буквального `files_owned` — см. JSDoc `GetCourierEarningsUseCase` (тот же приём).
 *
 * RBAC (текст тикета п.2) — В ОТЛИЧИЕ от `courier-earnings`: `courier` — `implicit scope: own`
 * (`filter[courierId]` игнорируется, тот же приём); `super_admin` — фильтр ОПЦИОНАЛЕН
 * (отсутствует ⇒ все батчи, `CourierPayoutsRepositoryPort.findPage({courierId: null, ...})`).
 */
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
  /** `filter[courierId]` — ИГНОРИРУЕТСЯ для `role==='courier'` (implicit own scope), ОПЦИОНАЛЕН для `super_admin`. */
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

  /** `null` — «все курьеры» (только `super_admin` БЕЗ `filter[courierId]`, см. JSDoc файла). */
  private async resolveCourierId(input: GetCourierPayoutsInput): Promise<string | null> {
    if (input.role === 'courier') {
      const courier = await this.couriers.findByUserId(input.userId)
      if (courier === null) {
        throw new NotFoundError({ userId: input.userId })
      }
      return courier.id
    }
    if (input.role !== 'super_admin') {
      // Оборонительный fallback — см. JSDoc `GetCourierEarningsUseCase.resolveCourierId`.
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
