/**
 * `RedisCartHoldStoreAdapter` (EP-09, DTJ-224) — реализация `CartHoldStorePort` поверх `ioredis`.
 *
 * Ключ значения — `cart:hold:{pharmacyId}:{medicineId}:{cartItemId}` (`SET qty EX ttlSeconds`,
 * ticket «Технический контекст»). ВТОРИЧНЫЙ ИНДЕКС — `ZSET cart:hold:idx:{pharmacyId}:
 * {medicineId}`, member = `cartItemId`, score = момент истечения (epoch ms) — единственный
 * способ найти «все активные холды на пару» без `KEYS`/`SCAN` по паттерну (D-EP09-12 §3,
 * `KEYS` — блокирующая O(n) операция на весь инстанс, запрещена в проде). `getActiveHolds`
 * стоит из ТРЁХ O(log n)/O(m)-команд (m = число активных холдов на ЭТУ пару, не на весь
 * keyspace): `ZREMRANGEBYSCORE` (чистит просроченные члены индекса) → `ZRANGE` (кандидаты) →
 * `MGET` (батч чтения количеств, не N отдельных `GET`).
 *
 * `hold`/`extend` СВОЮ ошибку соединения ГЛОТАЮТ (лог `WARN`, не бросают) — мягкий резерв не
 * имеет права заблокировать мутацию корзины (`AddCartItemUseCase`/
 * `UpdateCartItemQuantityUseCase`/`ExtendCartHoldUseCase` не обязаны знать о деградации Redis).
 * `getActiveHolds` СВОЮ ошибку ПРОБРАСЫВАЕТ — fail-open реализован в `AvailabilityCalculator`
 * (JSDoc порта — разное поведение чтения/записи здесь оба «мягкие», решение зафиксировано на
 * уровне порта, не случайность).
 *
 * `Date.now()` — этот файл `infrastructure/`, не `domain/`/`application/`:
 * `dorutj/domain-purity` (`eslint.config.mjs`, `files: ['**\/domain/**\/*.ts']`) сюда не
 * распространяется, прямой `Date.now()` разрешён (тот же приём, что остальные Redis-адаптеры
 * `infrastructure/`, например `redis-order-number-generator.adapter.ts`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  CART_HOLD_STORE_PORT,
  type CartHoldCommand,
  type CartHoldExtendCommand,
  type CartHoldStorePort,
} from '@/modules/orders/application/ports/cart-hold-store.port.js'

const CART_HOLD_KEY_PREFIX = 'cart:hold:'
const CART_HOLD_INDEX_KEY_PREFIX = 'cart:hold:idx:'
const MS_PER_SECOND = 1000
/** `EXPIRE` вернул `1` — ключ существовал и TTL обновлён (ioredis: `0` — ключа уже не было). */
const EXPIRE_RENEWED = 1
const EMPTY_ACTIVE_HOLDS = 0

function buildHoldKey(pharmacyId: string, medicineId: string, cartItemId: string): string {
  return `${CART_HOLD_KEY_PREFIX}${pharmacyId}:${medicineId}:${cartItemId}`
}

function buildIndexKey(pharmacyId: string, medicineId: string): string {
  return `${CART_HOLD_INDEX_KEY_PREFIX}${pharmacyId}:${medicineId}`
}

@Injectable()
export class RedisCartHoldStoreAdapter implements CartHoldStorePort {
  private readonly logger = new Logger(RedisCartHoldStoreAdapter.name)

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async hold(command: CartHoldCommand): Promise<void> {
    try {
      const { pharmacyId, medicineId, cartItemId, quantity, ttlSeconds } = command
      const expiresAtMs = Date.now() + ttlSeconds * MS_PER_SECOND
      await this.redis.set(buildHoldKey(pharmacyId, medicineId, cartItemId), String(quantity), 'EX', ttlSeconds)
      await this.redis.zadd(buildIndexKey(pharmacyId, medicineId), expiresAtMs, cartItemId)
    } catch (error: unknown) {
      this.logger.warn(`cart_hold_write_failed (hold) — деградация без вычета (SRS-ORD-008): ${String(error)}`)
    }
  }

  async extend(command: CartHoldExtendCommand): Promise<void> {
    try {
      const { pharmacyId, medicineId, cartItemId, ttlSeconds } = command
      const renewed = await this.redis.expire(buildHoldKey(pharmacyId, medicineId, cartItemId), ttlSeconds)
      if (renewed === EXPIRE_RENEWED) {
        const expiresAtMs = Date.now() + ttlSeconds * MS_PER_SECOND
        await this.redis.zadd(buildIndexKey(pharmacyId, medicineId), expiresAtMs, cartItemId)
      }
    } catch (error: unknown) {
      this.logger.warn(`cart_hold_write_failed (extend) — деградация без вычета (SRS-ORD-008): ${String(error)}`)
    }
  }

  async getActiveHolds(pharmacyId: string, medicineId: string, excludeCartItemId?: string): Promise<number> {
    const indexKey = buildIndexKey(pharmacyId, medicineId)
    // Чистит члены индекса, чей `score` (момент истечения) уже в прошлом — без этого шага
    // просроченные `cartItemId` копились бы в ZSET бесконечно (сам ключ хранения истёк по
    // `EXPIRE`, но индекс — отдельная структура, её не подчищает Redis сам).
    await this.redis.zremrangebyscore(indexKey, '-inf', Date.now())
    const candidateIds = await this.redis.zrange(indexKey, 0, -1)
    const relevantIds = candidateIds.filter((id) => id !== excludeCartItemId)
    if (relevantIds.length === 0) {
      return EMPTY_ACTIVE_HOLDS
    }
    const holdKeys = relevantIds.map((id) => buildHoldKey(pharmacyId, medicineId, id))
    const values = await this.redis.mget(...holdKeys)
    return values.reduce<number>((sum, raw) => (raw === null ? sum : sum + Number(raw)), EMPTY_ACTIVE_HOLDS)
  }
}

export const CART_HOLD_STORE_REDIS_PROVIDER = {
  provide: CART_HOLD_STORE_PORT,
  useClass: RedisCartHoldStoreAdapter,
} as const
