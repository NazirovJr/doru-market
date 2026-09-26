// DTJ-383/384 — построчные отчёты (в отличие от analytics-dashboard.controller.ts — платформенные агрегаты).
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  FunnelQuerySchema,
  ok,
  TopAnalogsQuerySchema,
  type FunnelQueryDto,
  type OnboardingFunnelResponseDto,
  type SuccessEnvelope,
  type TopAnalogsQueryDto,
  type TopAnalogsResponseDto,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import {
  GetTopAnalogsReportUseCase,
  type GetTopAnalogsReportResult,
} from '../application/use-cases/get-top-analogs-report.use-case.js'
import {
  GetOnboardingFunnelUseCase,
  type GetOnboardingFunnelResult,
} from '../application/use-cases/get-onboarding-funnel.use-case.js'

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class AnalyticsReportsController {
  public constructor(
    @Inject(GetTopAnalogsReportUseCase) private readonly getTopAnalogsReport: GetTopAnalogsReportUseCase,
    @Inject(GetOnboardingFunnelUseCase) private readonly getOnboardingFunnel: GetOnboardingFunnelUseCase,
  ) {}

  @Get('analytics/top-analogs')
  public async topAnalogs(
    @Query(new ZodValidationPipe(TopAnalogsQuerySchema)) query: TopAnalogsQueryDto,
  ): Promise<SuccessEnvelope<TopAnalogsResponseDto>> {
    const result = await this.getTopAnalogsReport.execute({
      tenantId: query.tenantId,
      period: query.period,
      limit: query.limit,
    })
    return ok(toTopAnalogsResponseDto(result))
  }

  @Get('analytics/onboarding-funnel')
  public async onboardingFunnel(
    @Query(new ZodValidationPipe(FunnelQuerySchema)) query: FunnelQueryDto,
  ): Promise<SuccessEnvelope<OnboardingFunnelResponseDto>> {
    const result = await this.getOnboardingFunnel.execute({ tenantId: query.tenantId, period: query.period })
    return ok(toOnboardingFunnelResponseDto(result))
  }
}

function toTopAnalogsResponseDto(result: GetTopAnalogsReportResult): TopAnalogsResponseDto {
  return result.map((item) => ({
    medicineId: item.medicineId,
    medicineName: item.medicineName,
    avgSavingsDiram: Number(item.avgSavingsDiram),
    timesShown: item.timesShown,
    conversionToOrder: item.conversionToOrder,
  }))
}

function toOnboardingFunnelResponseDto(result: GetOnboardingFunnelResult): OnboardingFunnelResponseDto {
  return result.map((item) => ({
    decision: item.decision,
    averageDurationHours: item.averageDurationHours,
    count: item.count,
  }))
}
