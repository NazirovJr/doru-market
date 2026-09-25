// DTJ-381 — воронка платформы (SRS-ADM-069), доступ только super_admin: не разрезается по сети/тенанту роли.
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  FunnelQuerySchema,
  ok,
  type FunnelQueryDto,
  type FunnelResponseDto,
  type PlatformMetricsResponseDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { GetFunnelUseCase, type GetFunnelResult } from '../application/use-cases/get-funnel.use-case.js'
import { GetPlatformMetricsUseCase, type GetPlatformMetricsResult } from '../application/use-cases/get-platform-metrics.use-case.js'

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class AnalyticsDashboardController {
  public constructor(
    @Inject(GetFunnelUseCase) private readonly getFunnel: GetFunnelUseCase,
    @Inject(GetPlatformMetricsUseCase) private readonly getPlatformMetrics: GetPlatformMetricsUseCase,
  ) {}

  @Get('analytics/funnel')
  public async funnel(
    @Query(new ZodValidationPipe(FunnelQuerySchema)) query: FunnelQueryDto,
  ): Promise<SuccessEnvelope<FunnelResponseDto>> {
    const result = await this.getFunnel.execute({ tenantId: query.tenantId, period: query.period })
    return ok(toResponseDto(result))
  }

  @Get('analytics/platform-metrics')
  public async platformMetrics(
    @Query(new ZodValidationPipe(FunnelQuerySchema)) query: FunnelQueryDto,
  ): Promise<SuccessEnvelope<PlatformMetricsResponseDto>> {
    const result = await this.getPlatformMetrics.execute({ tenantId: query.tenantId, period: query.period })
    return ok(toPlatformMetricsResponseDto(result))
  }
}

function toResponseDto(result: GetFunnelResult): FunnelResponseDto {
  return {
    searchPerformed: result.searchPerformed,
    analogShown: result.analogShown,
    analogClicked: result.analogClicked,
    addedToCart: result.addedToCart,
    orderPlaced: result.orderPlaced,
    conversionRates: result.conversionRates,
    totalSavingsShownDiram: Number(result.totalSavingsShownDiram),
    totalSavingsRealizedDiram: Number(result.totalSavingsRealizedDiram),
    weeklyTrend: result.weeklyTrend.map((point) => ({
      weekLabel: point.weekLabel,
      realizedSavingsDiram: Number(point.realizedSavingsDiram),
    })),
  }
}

function toPlatformMetricsResponseDto(result: GetPlatformMetricsResult): PlatformMetricsResponseDto {
  return {
    gmvDiram: Number(result.gmvDiram),
    orderCount: result.orderCount,
    averageCheckDiram: Number(result.averageCheckDiram),
    pickupSlaComplianceRate: result.pickupSlaComplianceRate,
    deliverySlaComplianceRate: result.deliverySlaComplianceRate,
    cancellationRate: result.cancellationRate,
    activePharmaciesSendingDataRate: result.activePharmaciesSendingDataRate,
  }
}
