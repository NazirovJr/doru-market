import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  DELIVERY_CANDIDATE_CACHE_PORT,
  type CachedCandidate,
  type DeliveryCandidateCachePort,
} from '@/modules/delivery/application/ports/delivery-candidate-cache.port.js'

const DEFAULT_RECANDIDATE_AFTER_MINUTES = 5 // ASSUMPTION 5 (ticket «Риски»)
const SECONDS_PER_MINUTE = 60
const KEY_PREFIX = 'delivery-candidates:'

@Injectable()
export class RedisDeliveryCandidateCacheAdapter implements DeliveryCandidateCachePort {
  private readonly logger = new Logger(RedisDeliveryCandidateCacheAdapter.name)

  public constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  public async get(assignmentId: string): Promise<readonly CachedCandidate[] | null> {
    try {
      const raw = await this.redis.get(buildKey(assignmentId))
      return raw === null ? null : (JSON.parse(raw) as CachedCandidate[])
    } catch (error: unknown) {
      this.logger.warn({ err: error, assignmentId }, 'delivery_candidate_cache_read_failed — деградация до промаха')
      return null
    }
  }

  public async set(assignmentId: string, candidates: readonly CachedCandidate[]): Promise<void> {
    try {
      const ttlSeconds = resolveTtlMinutes() * SECONDS_PER_MINUTE
      await this.redis.set(buildKey(assignmentId), JSON.stringify(candidates), 'EX', ttlSeconds)
    } catch (error: unknown) {
      this.logger.warn({ err: error, assignmentId }, 'delivery_candidate_cache_write_failed')
    }
  }
}

function buildKey(assignmentId: string): string {
  return `${KEY_PREFIX}${assignmentId}`
}

function resolveTtlMinutes(): number {
  const raw = process.env.RECANDIDATE_AFTER_MINUTES
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RECANDIDATE_AFTER_MINUTES
}

export const DELIVERY_CANDIDATE_CACHE_PORT_PROVIDER = {
  provide: DELIVERY_CANDIDATE_CACHE_PORT,
  useClass: RedisDeliveryCandidateCacheAdapter,
} as const
