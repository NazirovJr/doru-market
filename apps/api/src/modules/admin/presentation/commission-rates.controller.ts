// CommissionRatesController (DTJ-358) — /api/v1/finance/commission-rates, super_admin-only. Zod-валидация POST/PATCH — в UpsertCommissionRateUseCase, не здесь.
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import {
  CommissionRatesListQuerySchema,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  type CommissionRateDto,
  type CommissionRatesListQuery,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { CommissionRateView, FinanceCursor } from '../application/ports/payments-facade.port.js'
import { ListCommissionRatesUseCase } from '../application/use-cases/list-commission-rates.use-case.js'
import { UpsertCommissionRateUseCase } from '../application/use-cases/upsert-commission-rate.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'finance/commission-rates', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class CommissionRatesController {
  public constructor(
    @Inject(ListCommissionRatesUseCase) private readonly listRates: ListCommissionRatesUseCase,
    @Inject(UpsertCommissionRateUseCase) private readonly upsertRate: UpsertCommissionRateUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(CommissionRatesListQuerySchema)) query: CommissionRatesListQuery,
  ): Promise<SuccessEnvelope<readonly CommissionRateDto[]>> {
    const result = await this.listRates.execute({
      tenantId: query['filter[tenantId]'],
      chainId: query['filter[chainId]'],
      category: query['filter[category]'],
      limit: query.limit,
      cursor: parseFinanceCursor(query.cursor),
    })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toCommissionRateDto), { pagination: meta })
  }

  @Post()
  @HttpCode(HttpStatus.Created)
  public async create(@Body() body: unknown, @CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<CommissionRateDto>> {
    const view = await this.upsertRate.execute({ rawBody: body, actor: { userId: claims.sub } })
    return ok(toCommissionRateDto(view))
  }

  @Patch(':id')
  public async update(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<CommissionRateDto>> {
    const view = await this.upsertRate.execute({ id, rawBody: body, actor: { userId: claims.sub } })
    return ok(toCommissionRateDto(view))
  }
}

function parseFinanceCursor(raw: string | undefined): FinanceCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toCommissionRateDto(view: CommissionRateView): CommissionRateDto {
  return {
    ...view,
    category: view.category as CommissionRateDto['category'],
    createdAt: view.createdAt === null ? null : view.createdAt.toISOString(),
  }
}
