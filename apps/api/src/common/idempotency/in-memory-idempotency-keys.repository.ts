/**
 * `InMemoryIdempotencyKeysRepository` (EP-01, DTJ-019) — in-memory
 * адаптер для тестов и dev-режима без Postgres. Реальный `Drizzle`-адаптер
 * подключается в production (тикет EP-09, первый потребитель
 * `@Idempotent()` в `POST /orders`).
 *
 * Хранилище — `Map`, ключ — `${userId}:${endpoint}:${key}`. Гонка
 * моделируется через атомарный `Map.set()` (Node.js — single-threaded).
 */
import { randomUUID } from 'node:crypto'
import {
  type IdempotencyKeyRecord,
  IdempotencyKeyConflictError,
  type IdempotencyKeysRepository,
} from './idempotency-keys.repository.js'

const TRIPLE_SEPARATOR = '\u0000'

export class InMemoryIdempotencyKeysRepository implements IdempotencyKeysRepository {
  private readonly byTriple = new Map<string, IdempotencyKeyRecord>()

  private static tripleKey(userId: string, endpoint: string, key: string): string {
    return `${userId}${TRIPLE_SEPARATOR}${endpoint}${TRIPLE_SEPARATOR}${key}`
  }

  async findByTriple(userId: string, endpoint: string, key: string): Promise<IdempotencyKeyRecord | null> {
    return this.byTriple.get(InMemoryIdempotencyKeysRepository.tripleKey(userId, endpoint, key)) ?? null
  }

  async createProcessing(input: {
    userId: string
    endpoint: string
    key: string
    requestHash: string
  }): Promise<IdempotencyKeyRecord> {
    const composite = InMemoryIdempotencyKeysRepository.tripleKey(
      input.userId,
      input.endpoint,
      input.key,
    )
    if (this.byTriple.has(composite)) {
      throw new IdempotencyKeyConflictError({ reason: 'triple already exists' })
    }
    const record: IdempotencyKeyRecord = {
      id: randomUUID(),
      userId: input.userId,
      endpoint: input.endpoint,
      key: input.key,
      requestHash: input.requestHash,
      status: 'processing',
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
    }
    this.byTriple.set(composite, record)
    return record
  }

  async markCompleted(
    id: string,
    responseStatus: number,
    responseBody: IdempotencyKeyRecord['responseBody'],
  ): Promise<void> {
    for (const [triple, record] of this.byTriple) {
      if (record.id === id) {
        this.byTriple.set(triple, {
          ...record,
          status: 'completed',
          responseStatus,
          responseBody,
        })
        return
      }
    }
    throw new Error(`idempotency record not found: ${id}`)
  }
}
