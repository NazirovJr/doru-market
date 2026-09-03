/**
 * `DrizzleIdempotencyAttemptAdapter` — unit-набор (EP-09, DTJ-231 «foundIssue»). Регресс-тест на
 * `hashPayload`: `CheckoutCommand.expectedTotalDiramByPharmacy` (DTJ-231, поправка CTO волна 6,
 * SRS-ORD-023) — `Readonly<Record<string, bigint>>`, до DTJ-231 `JSON.stringify(payload)` на
 * объекте с `bigint`-полем бросал необработанный `TypeError` («Do not know how to serialize a
 * BigInt») внутри `begin()`/`findCompleted()`, роняя ЛЮБОЙ checkout-запрос с непустым ожиданием
 * до того, как бизнес-логика вообще запускалась (см. JSDoc `hashPayload` в
 * `idempotency-attempt.adapter.ts`). `bigintSafeReplacer` вызывается `JSON.stringify` НА КАЖДОМ
 * уровне вложенности, включая значения внутри вложенного объекта — тесты ниже проверяют это явно
 * (волна 6: поле стало Record'ом с bigint-значениями, не голым bigint верхнего уровня).
 */
import { describe, expect, it, vi } from 'vitest'
import type { IdempotencyKeysRepository } from '@/common/idempotency/idempotency-keys.repository.js'
import { DrizzleIdempotencyAttemptAdapter } from './idempotency-attempt.adapter.js'

/** `createProcessing` — ОТДЕЛЬНАЯ переменная (не `repo.createProcessing` в момент `expect(...)`):
 *  referencing метод-свойство объекта напрямую роняет `@typescript-eslint/unbound-method`. */
function makeCreateProcessingMock(): ReturnType<typeof vi.fn<IdempotencyKeysRepository['createProcessing']>> {
  return vi.fn<IdempotencyKeysRepository['createProcessing']>().mockResolvedValue({
    id: 'idem-1',
    userId: 'user-1',
    endpoint: 'checkout:create-orders',
    key: 'key-1',
    requestHash: 'hash',
    status: 'processing',
    responseStatus: null,
    responseBody: null,
    createdAt: new Date(),
  })
}

function makeRepo(overrides: Partial<IdempotencyKeysRepository> = {}): IdempotencyKeysRepository {
  return {
    findByTriple: vi.fn().mockResolvedValue(null),
    createProcessing: makeCreateProcessingMock(),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    releaseProcessing: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('DrizzleIdempotencyAttemptAdapter — bigint-safe hashPayload', () => {
  it('begin() с payload, содержащим Record<string, bigint> (expectedTotalDiramByPharmacy) — не бросает, хеширует нормально', async () => {
    const createProcessing = makeCreateProcessingMock()
    const repo = makeRepo({ createProcessing })
    const adapter = new DrizzleIdempotencyAttemptAdapter(repo)

    await expect(
      adapter.begin('user-1', 'key-1', {
        checkoutAttemptId: 'key-1',
        expectedTotalDiramByPharmacy: { 'pharmacy-1': 12_00n },
        cartItemIds: ['a'],
      }),
    ).resolves.toBe('idem-1')
    expect(createProcessing).toHaveBeenCalledWith(
      expect.objectContaining({ requestHash: expect.any(String) as string }),
    )
  })

  it('findCompleted() сверяет hash одинакового Record<string, bigint>-payload как СОВПАДАЮЩИЙ (не body_mismatch)', async () => {
    const payload = { checkoutAttemptId: 'key-1', expectedTotalDiramByPharmacy: { 'pharmacy-1': 12_00n }, cartItemIds: ['a'] }
    const createProcessing = makeCreateProcessingMock()
    const repo = makeRepo({ createProcessing })
    const adapterForHash = new DrizzleIdempotencyAttemptAdapter(repo)
    const beganId = await adapterForHash.begin('user-1', 'key-1', payload)
    const created = createProcessing.mock.calls[0]?.[0] as { requestHash: string }

    const repoWithCompleted = makeRepo({
      findByTriple: vi.fn().mockResolvedValue({
        id: beganId,
        userId: 'user-1',
        endpoint: 'checkout:create-orders',
        key: 'key-1',
        requestHash: created.requestHash,
        status: 'completed',
        responseStatus: 200,
        responseBody: { data: { orders: [], failedGroups: [], meta: { excludedItems: [] } } },
        createdAt: new Date(),
      }),
    })
    const adapter = new DrizzleIdempotencyAttemptAdapter(repoWithCompleted)

    await expect(adapter.findCompleted('user-1', 'key-1', payload)).resolves.toEqual({
      orders: [],
      failedGroups: [],
      meta: { excludedItems: [] },
    })
  })

  it('findCompleted() с DIFFERENT bigint-значением внутри Record — hash не совпадает → body_mismatch conflict', async () => {
    const repo = makeRepo({
      findByTriple: vi.fn().mockResolvedValue({
        id: 'idem-1',
        userId: 'user-1',
        endpoint: 'checkout:create-orders',
        key: 'key-1',
        requestHash: 'stale-hash-from-first-call',
        status: 'completed',
        responseStatus: 200,
        responseBody: { data: { orders: [], failedGroups: [], meta: { excludedItems: [] } } },
        createdAt: new Date(),
      }),
    })
    const adapter = new DrizzleIdempotencyAttemptAdapter(repo)

    await expect(
      adapter.findCompleted('user-1', 'key-1', { checkoutAttemptId: 'key-1', expectedTotalDiramByPharmacy: { 'pharmacy-1': 5_00n } }),
    ).rejects.toMatchObject({ name: 'IdempotencyKeyConflictError', details: { reason: 'body_mismatch' } })
  })

  it('begin() с payload, содержащим ДВЕ группы в expectedTotalDiramByPharmacy — хеширует все вложенные bigint-значения, не только первую', async () => {
    const createProcessing = makeCreateProcessingMock()
    const repo = makeRepo({ createProcessing })
    const adapter = new DrizzleIdempotencyAttemptAdapter(repo)

    await expect(
      adapter.begin('user-1', 'key-1', {
        checkoutAttemptId: 'key-1',
        expectedTotalDiramByPharmacy: { 'pharmacy-1': 12_00n, 'pharmacy-2': 34_00n },
        cartItemIds: ['a', 'b'],
      }),
    ).resolves.toBe('idem-1')
  })
})
