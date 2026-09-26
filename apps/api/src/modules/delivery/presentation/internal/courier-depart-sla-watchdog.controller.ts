// Вызывающий — исключительно apps/worker (courier-depart-sla-watchdog.job.ts), тот же мост, что DeliveryOfferTimeoutController.
import { Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ResolveCourierDepartSlaWatchdogUseCase } from '@/modules/delivery/application/use-cases/resolve-courier-depart-sla-watchdog.use-case.js'
import { DeliveryInternalServiceGuard } from './delivery-internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'internal/delivery-assignments', version: '1' })
@UseGuards(DeliveryInternalServiceGuard)
export class CourierDepartSlaWatchdogController {
  public constructor(
    @Inject(ResolveCourierDepartSlaWatchdogUseCase) private readonly resolveWatchdog: ResolveCourierDepartSlaWatchdogUseCase,
  ) {}

  @Post(':id/resolve-depart-sla-watchdog')
  @HttpCode(HttpStatus.OK)
  public async resolveDepartSlaWatchdog(@Param('id', ID_PARSE_UUID) deliveryAssignmentId: string): Promise<SuccessEnvelope<null>> {
    await this.resolveWatchdog.execute({ deliveryAssignmentId })
    return ok(null)
  }
}
