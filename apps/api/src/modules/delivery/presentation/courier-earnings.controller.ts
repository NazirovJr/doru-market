import { Controller, Get, HttpCode, Inject, Query, UseGuards } from '@nestjs/common'
import { encodeCursor, ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetCourierEarningsUseCase, type CourierEarningViewDto } from '../application/use-cases/get-courier-earnings.use-case.js'
import { parseCourierIdFilter, parseDeliveryListQuery, type DeliveryListQueryParams } from './delivery-list-query.util.js'

@Controller({ path: 'courier-earnings', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CourierEarningsController {
  public constructor(
    @Inject(GetCourierEarningsUseCase) private readonly getCourierEarnings: GetCourierEarningsUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.Ok)
  @Roles('courier', 'super_admin')
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query() query: DeliveryListQueryParams,
  ): Promise<SuccessEnvelope<readonly CourierEarningViewDto[]>> {
    const { limit, cursor } = parseDeliveryListQuery(query)
    const result = await this.getCourierEarnings.execute({
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
