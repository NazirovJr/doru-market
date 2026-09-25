import { Inject, Injectable, Logger } from '@nestjs/common'
import { AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY } from '@dorutj/contracts'
import { AUDIT_LOG_RETENTION_BATCH_SIZE, AUDIT_LOG_RETENTION_PORT, AUDIT_LOG_RETENTION_YEARS } from './audit-log-retention.constants.js'
import type { AuditLogRetentionPort } from './audit-log-retention.port.js'

export interface AuditLogRetentionResult {
  readonly deletedTotal: number
  readonly batches: number
}

@Injectable()
export class AuditLogRetentionJob {
  private readonly logger = new Logger(AuditLogRetentionJob.name)

  constructor(
    // esbuild/vitest не эмитит design:paramtypes.
    @Inject(AUDIT_LOG_RETENTION_PORT) private readonly retention: AuditLogRetentionPort,
    @Inject(AUDIT_LOG_RETENTION_YEARS) private readonly retentionYears: number,
    @Inject(AUDIT_LOG_RETENTION_BATCH_SIZE) private readonly batchSize: number,
  ) {}

  async runOnce(now: Date = new Date()): Promise<AuditLogRetentionResult> {
    const cutoff = computeCutoff(now, this.retentionYears)
    let deletedTotal = 0
    let batches = 0
    try {
      let deletedInBatch: number
      do {
        // eslint-disable-next-line no-await-in-loop -- батчи последовательные намеренно, не параллельный DELETE над одной таблицей.
        deletedInBatch = await this.retention.deleteBatch({
          cutoff,
          excludedCategory: AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY,
          batchSize: this.batchSize,
        })
        if (deletedInBatch > 0) {
          batches += 1
          deletedTotal += deletedInBatch
        }
      } while (deletedInBatch === this.batchSize)
    } catch (error) {
      this.logger.error(
        `audit-log-retention: тик прерван ошибкой — ${String(error)} (удалено до сбоя: ${String(deletedTotal)} строк(и) в ${String(batches)} батч(ах))`,
      )
      throw error
    }
    this.logger.log(
      `audit-log-retention: тик выполнен — удалено ${String(deletedTotal)} строк(и) в ${String(batches)} батч(ах), cutoff=${cutoff.toISOString()}`,
    )
    return { deletedTotal, batches }
  }
}

function computeCutoff(now: Date, retentionYears: number): Date {
  const cutoff = new Date(now.getTime())
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears) // календарный сдвиг, не приближение через мс
  return cutoff
}
