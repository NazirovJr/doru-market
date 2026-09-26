/**
 * Drizzle-реализация `OnboardingReviewLogRepositoryPort` (DTJ-068). INSERT-only.
 * `update`/`delete` НЕ реализованы — соответствует контракту порта.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { onboardingReviewLog } from '@/db/schema/onboarding-review-log.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewDurationStat,
  type OnboardingReviewLogRepositoryPort,
  type OnboardingReviewPeriodRange,
  type ReviewLogEntry,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'

export { ONBOARDING_REVIEW_LOG_REPOSITORY }

interface ReviewDurationSqlRow {
  readonly decision: 'approved' | 'rejected'
  readonly avg_hours: string
  readonly cnt: string
}

@Injectable()
export class DrizzleOnboardingReviewLogRepository implements OnboardingReviewLogRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async append(entry: ReviewLogEntry): Promise<void> {
    await this.db.insert(onboardingReviewLog).values({
      chainId: entry.chainId ?? null,
      pharmacyId: entry.pharmacyId ?? null,
      action: entry.action,
      actorUserId: entry.actorUserId,
      reason: entry.reason,
      checklistSnapshot: entry.checklistSnapshot,
    })
  }

  async getReviewDurationStats(
    tenantId: string,
    period: OnboardingReviewPeriodRange,
  ): Promise<readonly OnboardingReviewDurationStat[]> {
    const result = await this.db.execute(reviewDurationStatsQuery(tenantId, period))
    return extractRows(result).map(toReviewDurationStat)
  }
}

// `last_action` — последняя запись лога на chainId; если это approve/reject, submitted_at (текущее
// значение) ещё не был перезаписан следующей подачей — корректно даже после resubmit-цикла.
// `paused` — суммирует интервалы changes_requested ПОСЛЕ текущего submitted_at (LEAD-окно), не
// затрагивая более ранние циклы того же chainId.
function reviewDurationStatsQuery(tenantId: string, period: OnboardingReviewPeriodRange) {
  return sql`
    WITH last_action AS (
      SELECT DISTINCT ON (chain_id) chain_id, action, created_at AS resolved_at
      FROM onboarding_review_log
      WHERE chain_id IS NOT NULL
      ORDER BY chain_id, created_at DESC
    ),
    resolved AS (
      SELECT chain_id, action, resolved_at FROM last_action WHERE action IN ('approve', 'reject')
    ),
    log_with_next AS (
      SELECT chain_id, action, created_at,
        LEAD(created_at) OVER (PARTITION BY chain_id ORDER BY created_at) AS next_created_at
      FROM onboarding_review_log
      WHERE chain_id IS NOT NULL
    ),
    paused AS (
      SELECT l.chain_id, SUM(l.next_created_at - l.created_at) AS paused_interval
      FROM log_with_next l
      JOIN pharmacy_chains pc ON pc.id = l.chain_id
      WHERE l.action = 'changes_requested' AND l.next_created_at IS NOT NULL AND l.created_at >= pc.submitted_at
      GROUP BY l.chain_id
    )
    SELECT
      CASE r.action WHEN 'approve' THEN 'approved' ELSE 'rejected' END AS decision,
      (
        AVG(EXTRACT(EPOCH FROM (r.resolved_at - pc.submitted_at - COALESCE(p.paused_interval, interval '0'))) / 3600)
      )::text AS avg_hours,
      COUNT(*)::text AS cnt
    FROM resolved r
    JOIN pharmacy_chains pc ON pc.id = r.chain_id
    LEFT JOIN paused p ON p.chain_id = r.chain_id
    WHERE pc.tenant_id = ${tenantId}
      AND pc.submitted_at IS NOT NULL
      AND r.resolved_at >= ${period.start}
      AND r.resolved_at < ${period.end}
    GROUP BY r.action
  `
}

/** Нормализация `db.execute(...)` для разных драйверов Drizzle — тот же приём, что product-events.repository.ts. */
function extractRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) {
    return result
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows
    }
  }
  return []
}

function toReviewDurationStat(row: unknown): OnboardingReviewDurationStat {
  const typed = row as ReviewDurationSqlRow
  return { decision: typed.decision, averageDurationHours: Number(typed.avg_hours), count: Number(typed.cnt) }
}
