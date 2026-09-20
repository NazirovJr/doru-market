/** DTJ-307 (EP-12, SRS-PHT-032..034) — консьюмер `picking-sla-watchdog`: soft → internal picking-sla-breach, hard → system-cancel. Статус заказа проверяет apps/api. */
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { requestSystemOrderCancel, type SystemOrderCancelDeps } from './system-order-cancel.client.js'
import { PICKING_SLA_JOB_HARD, PICKING_SLA_JOB_SOFT, type PickingSlaWatchdogJobData } from './picking-sla-watchdog.types.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

@Injectable()
export class PickingSlaWatchdogJob {
  private readonly logger = new Logger(PickingSlaWatchdogJob.name)

  public async process(job: Job<PickingSlaWatchdogJobData>, deps: SystemOrderCancelDeps): Promise<void> {
    if (job.name === PICKING_SLA_JOB_SOFT) {
      await this.reportSoftBreach(job.data, deps)
      return
    }
    if (job.name === PICKING_SLA_JOB_HARD) {
      const result = await requestSystemOrderCancel(deps, {
        orderId: job.data.orderId,
        tenantId: job.data.tenantId,
        expectedFromStatus: 'processing',
        reason: 'pickup_sla_timeout',
      })
      this.logger.log(`picking-sla-watchdog: hard orderId=${job.data.orderId} → ${result.status}`)
      return
    }
    throw new Error(`picking-sla-watchdog: unknown job name "${job.name}"`)
  }

  private async reportSoftBreach(data: PickingSlaWatchdogJobData, deps: SystemOrderCancelDeps): Promise<void> {
    if (deps.internalApiKey === undefined) {
      // Ошибка конфигурации — бросает, не молчит (тот же приём, что requestSystemOrderCancel).
      throw new Error('INTERNAL_API_KEY is not configured — cannot call internal picking-sla-breach endpoint')
    }
    const url = new URL(`/api/v1/internal/orders/${data.orderId}/picking-sla-breach`, deps.apiInternalUrl)
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_API_KEY_HEADER]: deps.internalApiKey },
      body: JSON.stringify({ tenantId: data.tenantId }),
    })
    if (!response.ok) {
      throw new Error(
        `picking-sla-watchdog: picking-sla-breach POST failed for orderId=${data.orderId} (HTTP ${String(response.status)})`,
      )
    }
    this.logger.log(`picking-sla-watchdog: soft orderId=${data.orderId} reported (or already progressed)`)
  }
}