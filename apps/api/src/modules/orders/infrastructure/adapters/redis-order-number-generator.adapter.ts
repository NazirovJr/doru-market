/**
 * `RedisOrderNumberGeneratorAdapter` (EP-09, DTJ-221, SRS-DOM-085) — реализация
 * `OrderNumberGeneratorPort` (порт+VO уже существуют: `shared-kernel/application/ports/
 * order-number-generator.port.ts`, `shared-kernel/domain/value-objects/order-number.vo.ts`,
 * EP-01 DTJ-011 — не заводить вторую копию, `AGENTS.md` правило 12).
 *
 * `INCR order_seq:{dateYYMMDD}` + `EXPIRE` на первый инкремент дня (48ч — переживает возможную
 * задержку релея outbox через полночь по Asia/Dushanbe). Переиспользует общий `REDIS_CLIENT`
 * (`@/infrastructure/redis`) — не поднимает новое соединение (DTJ-221 «Технический контекст»).
 *
 * `dateYYMMDD` вычисляется ВЫЗЫВАЮЩИМ кодом (порт принимает готовую строку — JSDoc порта) —
 * этот адаптер не знает о таймзонах.
 */
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  ORDER_NUMBER_GENERATOR,
  type OrderNumberGeneratorPort,
} from '@/shared-kernel/application/ports/order-number-generator.port.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

const ORDER_SEQ_KEY_PREFIX = 'order_seq:'
const ORDER_SEQ_TTL_SECONDS = 172_800
const FIRST_INCREMENT = 1

@Injectable()
export class RedisOrderNumberGeneratorAdapter implements OrderNumberGeneratorPort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async generate(dateYYMMDD: string): Promise<OrderNumber> {
    const key = `${ORDER_SEQ_KEY_PREFIX}${dateYYMMDD}`
    const seq = await this.redis.incr(key)
    if (seq === FIRST_INCREMENT) {
      await this.redis.expire(key, ORDER_SEQ_TTL_SECONDS)
    }
    // seq > 99999 → OrderNumberSequenceExhaustedError, брошенная самим VO (двойной рубеж защиты).
    return OrderNumber.fromParts(dateYYMMDD, seq)
  }
}

export { ORDER_NUMBER_GENERATOR }
