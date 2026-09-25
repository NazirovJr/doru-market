// DTJ-383 — построчные отчёты (в отличие от analytics-dashboard.controller.ts — платформенные агрегаты).
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  ok,
  TopAnalogsQuerySchema,
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

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class AnalyticsReportsController {
  public constructor(
    @Inject(GetTopAnalogsReportUseCase) private readonly getTopAnalogsReport: GetTopAnalogsReportUseCase,
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
