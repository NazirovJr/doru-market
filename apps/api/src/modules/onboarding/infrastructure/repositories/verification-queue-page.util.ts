import type { QueueItem, QueuePage } from '@/modules/onboarding/application/ports/verification-queue.types.js'

/** Срез `limit + 1` строк → страница с курсором на последнюю строку (keyset: submittedAt asc, id asc). */
export function toQueuePage(rows: readonly QueueItem[], limit: number): QueuePage {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const anchor = last?.submittedAt
  return {
    items,
    hasMore,
    nextCursor: hasMore && last !== undefined && anchor != null ? { v: anchor.toISOString(), id: last.id } : null,
  }
}
