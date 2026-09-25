export const DELIVERY_CANDIDATE_CACHE_PORT = Symbol.for('@dorutj/delivery/candidate-cache-port')

export interface CachedCandidate {
  readonly courierId: string
  readonly distanceMeters: number
  readonly score: number
}

// Фиксирует список кандидатов на весь цикл эскалации одного назначения, TTL=RECANDIDATE_AFTER_MINUTES.
export interface DeliveryCandidateCachePort {
  get(assignmentId: string): Promise<readonly CachedCandidate[] | null>
  set(assignmentId: string, candidates: readonly CachedCandidate[]): Promise<void>
}
