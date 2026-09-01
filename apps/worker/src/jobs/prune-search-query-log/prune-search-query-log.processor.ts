/**
 * Ядро джобы `prune-search-query-log` (DTJ-181, `SRS-CAT-070`): удаляет строки
 * `search_query_log` старше `SEARCH_QUERY_LOG_RETENTION_DAYS` (ENV, ASSUMPTION 180 —
 * `docs/spec/20-module-catalog-search.md` §14.3). `now` — параметр с дефолтом
 * `new Date()` (не порт `Clock`, зеркало `LicenseExpiryCheckProcessor.runOnce`, тот же
 * пакет apps/worker) — тест-план тикета проверяет детерминированный расчёт `cutoff`,
 * передавая фиксированную дату вместо реального времени.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { SEARCH_QUERY_LOG_RETENTION_DAYS } from './prune-search-query-log.constants.js'
import { SEARCH_QUERY_LOG_RETENTION_PORT, type SearchQueryLogRetentionPort } from './search-query-log-retention.port.js'

const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

@Injectable()
export class PruneSearchQueryLogProcessor {
  private readonly logger = new Logger(PruneSearchQueryLogProcessor.name)

  constructor(
    @Inject(SEARCH_QUERY_LOG_RETENTION_PORT) private readonly retention: SearchQueryLogRetentionPort,
    @Inject(SEARCH_QUERY_LOG_RETENTION_DAYS) private readonly retentionDays: number,
  ) {}

  /** Один тик: возвращает число удалённых строк `search_query_log`. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retentionDays * MS_PER_DAY)
    const deleted = await this.retention.deleteOlderThan(cutoff)
    this.logger.log(
      `prune-search-query-log: тик выполнен, удалено ${String(deleted)} строк(и) старше ${cutoff.toISOString()}`,
    )
    return deleted
  }
}
