// Только мост (HTTP-ретрансляция deliveryAssignmentId к apps/api), 1:1 приём DeliveryOfferTimeoutJob.
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import type { CourierDepartSlaWatchdogJobData } from './courier-depart-sla-watchdog.types.js'

const RESOLVE_WATCHDOG_PATH_SUFFIX = '/resolve-depart-sla-watchdog'
const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

export interface CourierDepartSlaWatchdogJobDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

@Injectable()
export class CourierDepartSlaWatchdogJob {
  private readonly logger = new Logger(CourierDepartSlaWatchdogJob.name)

  public async process(job: Job<CourierDepartSlaWatchdogJobData>, deps: CourierDepartSlaWatchdogJobDeps): Promise<void> {
    if (deps.internalApiKey === undefined) {
      throw new Error('INTERNAL_API_KEY is not configured — cannot call internal resolve-depart-sla-watchdog endpoint')
    }
    const url = new URL(
      `/api/v1/internal/delivery-assignments/${job.data.deliveryAssignmentId}${RESOLVE_WATCHDOG_PATH_SUFFIX}`,
      deps.apiInternalUrl,
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_API_KEY_HEADER]: deps.internalApiKey },
    })
    if (!response.ok) {
      throw new Error(
        `courier-depart-sla-watchdog: resolve POST failed for deliveryAssignmentId=${job.data.deliveryAssignmentId} (HTTP ${String(response.status)})`,
      )
    }
    this.logger.log(`courier-depart-sla-watchdog: deliveryAssignmentId=${job.data.deliveryAssignmentId} resolved (or already settled)`)
  }
}
