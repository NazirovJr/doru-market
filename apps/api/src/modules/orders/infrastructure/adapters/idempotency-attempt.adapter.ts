/**
 * `DrizzleIdempotencyAttemptAdapter` (EP-09, DTJ-227) — реализация `IdempotencyAttemptAdapter`
 * (`application/ports/idempotency-attempt.port.ts`) поверх ОБЩЕГО механизма `idempotency_keys`
 * (`common/idempotency/idempotency-keys.repository.ts`, EP-01 DTJ-017/019, D-EP09-4).
 */
import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  IDEMPOTENCY_KEYS,
  IdempotencyKeyConflictError,
  type IdempotencyKeysRepository,
} from '@/common/idempotency/idempotency-keys.repository.js'
import {
  CHECKOUT_IDEMPOTENCY_ENDPOINT,
  IDEMPOTENCY_ATTEMPT_ADAPTER,
  type IdempotencyAttemptAdapter,
} from '@/modules/orders/application/ports/idempotency-attempt.port.js'
import type { CheckoutResultDto } from '@/modules/orders/application/checkout/dto/checkout-result.dto.js'

const CHECKOUT_SUCCESS_HTTP_STATUS = 201

@Injectable()
export class DrizzleIdempotencyAttemptAdapter implements IdempotencyAttemptAdapter {
  constructor(@Inject(IDEMPOTENCY_KEYS) private readonly repo: IdempotencyKeysRepository) {}

  async findCompleted(userId: string, checkoutAttemptId: string, payload: unknown): Promise<CheckoutResultDto | null> {
    const existing = await this.repo.findByTriple(userId, CHECKOUT_IDEMPOTENCY_ENDPOINT, checkoutAttemptId)
    if (existing === null) {
      return null
    }
    if (existing.status === 'processing') {
      throw new IdempotencyKeyConflictError({ reason: 'still_processing' })
    }
    if (existing.requestHash !== hashPayload(payload)) {
      throw new IdempotencyKeyConflictError({ reason: 'body_mismatch' })
    }
    const body = existing.responseBody
    if (body === null || !('data' in body)) {
      throw new Error(`idempotency record ${existing.id} completed without a cached checkout result`)
    }
    return body.data as CheckoutResultDto
  }

  async begin(userId: string, checkoutAttemptId: string, payload: unknown): Promise<string> {
    const created = await this.repo.createProcessing({
      userId,
      endpoint: CHECKOUT_IDEMPOTENCY_ENDPOINT,
      key: checkoutAttemptId,
      requestHash: hashPayload(payload),
    })
    return created.id
  }

  async complete(id: string, result: CheckoutResultDto): Promise<void> {
    await this.repo.markCompleted(id, CHECKOUT_SUCCESS_HTTP_STATUS, { data: result })
  }

  async release(id: string): Promise<void> {
    await this.repo.releaseProcessing(id)
  }
}

/**
 * `JSON.stringify` бросает `TypeError` на `bigint` (Node не умеет сериализовать его нативно) —
 * `CheckoutCommand.expectedTotalDiramByPharmacy` (DTJ-231, поправка CTO волна 6, SRS-ORD-023)
 * ИМЕННО `Readonly<Record<string, bigint>>`, значит ЛЮБОЙ checkout-запрос, где клиент передал
 * подтверждённую сумму хотя бы одной группы, ронял бы `begin()`/`findCompleted()`
 * необработанным исключением ДО того, как `DetectPriceDriftService` вообще успевал сравнить
 * суммы — найдено при подключении DTJ-231 (foundIssue, поле ранее ни разу не проходило через
 * ЭТОТ hashPayload: юнит-набор `checkout.use-case.spec.ts` использует
 * `InMemoryIdempotencyAttemptAdapter`, который вообще не хеширует payload). Реплейсер приводит
 * `bigint` к строке ПЕРЕД сериализацией — `JSON.stringify` вызывает его на КАЖДОМ уровне
 * вложенности (значения внутри `expectedTotalDiramByPharmacy` включительно, не только
 * bigint-поля верхнего уровня), тот же хеш для всех прежних (без bigint-полей) payload'ов,
 * теперь безопасен и для новых.
 */
function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload, bigintSafeReplacer)
  return createHash('sha256').update(json, 'utf-8').digest('hex')
}

/** Явные типы (не инлайн-стрелка на `any`-сигнатуре `JSON.stringify`) — иначе `no-unsafe-return`. */
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export const IDEMPOTENCY_ATTEMPT_ADAPTER_PROVIDER = {
  provide: IDEMPOTENCY_ATTEMPT_ADAPTER,
  useClass: DrizzleIdempotencyAttemptAdapter,
} as const
