/** DTJ-307 (EP-12, SRS-PHT-032/033, D-19) — при accept ставит два delayed job SLA сборки: мягкий через pickup_sla, жёсткий через pickup_sla + buffer. */
import { Inject, Injectable } from '@nestjs/common'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { SLA_WATCHDOG_QUEUE, type SlaWatchdogQueuePort } from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'

export interface ScheduleSlaWatchdogCommand {
  readonly orderId: string
  readonly tenantId: string
}

@Injectable()
export class ScheduleSlaWatchdogUseCase {
  constructor(
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(SLA_WATCHDOG_QUEUE) private readonly slaWatchdogQueue: SlaWatchdogQueuePort,
  ) {}

  async execute(cmd: ScheduleSlaWatchdogCommand): Promise<void> {
    const slaMinutes = await this.tenancyFacade.getPickupSlaMinutes(cmd.tenantId)
    const bufferMinutes = await this.tenancyFacade.getPickupSlaBufferMinutes(cmd.tenantId)
    await this.slaWatchdogQueue.schedule({
      orderId: cmd.orderId,
      tenantId: cmd.tenantId,
      softDelayMinutes: slaMinutes,
      hardDelayMinutes: slaMinutes + bufferMinutes,
    })
  }
}