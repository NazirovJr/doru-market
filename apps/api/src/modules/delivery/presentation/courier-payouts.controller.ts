import { Controller, Get, HttpCode, Inject, Query, UseGuards } from '@nestjs/common'
import { encodeCursor, ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetCourierPayoutsUseCase, type CourierPayoutViewDto } from '../application/use-cases/get-courier-payouts.use-case.js'
import { parseCourierIdFilter, parseDeliveryListQuery, type DeliveryListQueryParams } from './delivery-list-query.util.js'

@Controller({ path: 'courier-payouts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CourierPayoutsController {
  public constructor(
    @Inject(GetCourierPayoutsUseCase) private readonly getCourierPayouts: GetCourierPayoutsUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.Ok)
  @Roles('courier', 'super_admin')
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query() query: DeliveryListQueryParams,
  ): Promise<SuccessEnvelope<readonly CourierPayoutViewDto[]>> {
    const { limit, cursor } = parseDeliveryListQuery(query)
    const result = await this.getCourierPayouts.execute({
      role: claims.role,
      userId: claims.sub,
      filterCourierId: parseCourierIdFilter(query),
      limit,
      cursor,
    })
    const pagination: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit,
    }
    return ok(result.items, { pagination })
  }
}
