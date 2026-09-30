export interface QueueCursor {
  readonly v: string
  readonly id: string
}

export interface ListQueueQuery {
  readonly status?: string
  readonly limit: number
  readonly cursor: QueueCursor | null
}

export interface QueueItem {
  readonly id: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly reviewReason: string | null
  readonly slaTargetAt: Date | null
}

export interface QueuePage {
  readonly items: readonly QueueItem[]
  readonly nextCursor: QueueCursor | null
  readonly hasMore: boolean
}
