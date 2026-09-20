/** DTJ-307 (EP-12) — мост apps/worker → apps/api: мягкое нарушение SLA сборки (`InternalServiceGuard`, как system-cancel). */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ReportPickingSlaBreachUseCase,
  type ReportPickingSlaBreachResult,
} from '@/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

const PickingSlaBreachRequestSchema = z.object({
  tenantId: z.uuid(),
})
type PickingSlaBreachRequest = z.infer<typeof PickingSlaBreachRequestSchema>

@Controller({ path: 'internal/orders', version: '1' })
@UseGuards(InternalServiceGuard)
export class PickingSlaBreachController {
  public constructor(
    @Inject(ReportPickingSlaBreachUseCase) private readonly reportPickingSlaBreach: ReportPickingSlaBreachUseCase,
  ) {}

  @Post(':id/picking-sla-breach')
  @HttpCode(HttpStatus.OK)
  public async report(
    @Param('id', ID_PARSE_UUID) orderId: string,
    @Body(new ZodValidationPipe(PickingSlaBreachRequestSchema)) body: PickingSlaBreachRequest,
  ): Promise<SuccessEnvelope<ReportPickingSlaBreachResult>> {
    const result = await this.reportPickingSlaBreach.execute({ tenantId: body.tenantId, orderId })
    return ok(result)
  }
}