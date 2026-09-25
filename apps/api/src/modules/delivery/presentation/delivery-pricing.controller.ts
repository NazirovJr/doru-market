// GET/PUT /api/v1/delivery-pricing-rules. Тенант — из TenantContext, не из query/пути.
import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, Put, Query, UseGuards } from '@nestjs/common'
import { ErrorCode, ok, putDeliveryPricingRuleRequestSchema, type PutDeliveryPricingRuleRequest, type SuccessEnvelope } from '@dorutj/contracts'
import { z } from 'zod'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ManageDeliveryPricingRulesUseCase } from '../application/use-cases/manage-delivery-pricing-rules.use-case.js'
import { toDeliveryPricingRuleViewDto, type DeliveryPricingRuleViewDto } from './delivery-pricing-rule-view.dto.js'

const zoneIdQuerySchema = z.object({ zoneId: z.uuid().optional() })

@Controller({ path: 'delivery-pricing-rules', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryPricingController {
  public constructor(
    @Inject(ManageDeliveryPricingRulesUseCase) private readonly manage: ManageDeliveryPricingRulesUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.Ok)
  @Roles('super_admin')
  public async getCurrent(
    @CurrentUser() claims: JwtClaims,
    @Query() query: unknown,
  ): Promise<SuccessEnvelope<DeliveryPricingRuleViewDto | null>> {
    const { zoneId } = zoneIdQuerySchema.parse(query)
    const rule = await this.manage.getCurrent(resolveTenantId(), zoneId ?? null, { userId: claims.sub, role: claims.role })
    return ok(rule === null ? null : toDeliveryPricingRuleViewDto(rule))
  }

  @Put()
  @HttpCode(HttpStatus.Ok)
  @Roles('super_admin')
  public async put(
    @Body(new ZodValidationPipe(putDeliveryPricingRuleRequestSchema)) body: PutDeliveryPricingRuleRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DeliveryPricingRuleViewDto>> {
    const rule = await this.manage.put({
      tenantId: resolveTenantId(),
      zoneId: body.zoneId ?? null,
      baseRateDiram: BigInt(body.baseRateDiram),
      ratePerKmDiram: BigInt(body.ratePerKmDiram),
      minOrderAmountDiram: BigInt(body.minOrderAmountDiram),
      freeDeliveryThresholdDiram: body.freeDeliveryThresholdDiram == null ? null : BigInt(body.freeDeliveryThresholdDiram),
      nightTariffStartTime: body.nightTariffStartTime ?? null,
      nightTariffEndTime: body.nightTariffEndTime ?? null,
      nightTariffExtraDiram: BigInt(body.nightTariffExtraDiram),
      actor: { userId: claims.sub, role: claims.role },
    })
    return ok(toDeliveryPricingRuleViewDto(rule))
  }
}

function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
