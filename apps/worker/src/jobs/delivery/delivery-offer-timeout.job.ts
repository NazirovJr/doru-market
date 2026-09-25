// Только мост (HTTP-ретрансляция offerId к apps/api), 1:1 приём PartialFulfillmentTimeoutJob.
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import type { DeliveryOfferTimeoutJobData } from './delivery-offer-timeout.types.js'

const RESOLVE_TIMEOUT_PATH_SUFFIX = '/resolve-timeout'
const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

export interface DeliveryOfferTimeoutJobDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

@Injectable()
export class DeliveryOfferTimeoutJob {
  private readonly logger = new Logger(DeliveryOfferTimeoutJob.name)

  public async process(job: Job<DeliveryOfferTimeoutJobData>, deps: DeliveryOfferTimeoutJobDeps): Promise<void> {
    if (deps.internalApiKey === undefined) {
      throw new Error('INTERNAL_API_KEY is not configured — cannot call internal resolve-timeout endpoint')
    }
    const url = new URL(
      `/api/v1/internal/delivery-offers/${job.data.offerId}${RESOLVE_TIMEOUT_PATH_SUFFIX}`,
      deps.apiInternalUrl,
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_API_KEY_HEADER]: deps.internalApiKey },
    })
    if (!response.ok) {
      throw new Error(
        `delivery-offer-timeout: resolve-timeout POST failed for offerId=${job.data.offerId} (HTTP ${String(response.status)})`,
      )
    }
    this.logger.log(`delivery-offer-timeout: offerId=${job.data.offerId} resolved (or already settled)`)
  }
}
