/**
 * `CourierEarningsController` (EP-13, DTJ-321, SRS-DELIV-030) — `GET /api/v1/courier-earnings`.
 * Тонкий HTTP-слой (`02` §1.1) — вся RBAC/пагинация в `GetCourierEarningsUseCase`.
 *
 * `filter[courierId]` — литеральный query-ключ, Fastify без `qs` не разворачивает bracket-nesting
 * (1:1 приём `PharmacyTerminalQueueController.filterPharmacyIdRaw`, DTJ-301 — см. её JSDoc).
 *
 * Маппинг ошибок — `AllExceptionsFilter` (единственный фильтр приложения): `NotFoundError`(404,
 * courier не резолвится по userId)/`ValidationError`(400, `super_admin` без обязательного
 * фильтра) — уже зарегистрированы в `ERROR_HTTP_STATUS` (`@dorutj/contracts`), этот контроллер их
 * не перехватывает.
 */
import { Controller, Get, HttpCode, Inject, Query, UseGuards } from '@nestjs/common'
import { encodeCursor, ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetCourierEarningsUseCase, type CourierEarningViewDto } from '../application/use-cases/get-courier-earnings.use-case.js'
import { parseCourierIdFilter, parseDeliveryListQuery, type DeliveryListQueryParams } from './delivery-list-query.util.js'

@Controller({ path: 'courier-earnings', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CourierEarningsController {
  // Явный @Inject на каждом параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
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
