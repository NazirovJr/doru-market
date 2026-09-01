import { describe, expect, it } from 'vitest'
import { InMemoryIdempotencyKeysRepository } from './in-memory-idempotency-keys.repository.js'
import { IdempotencyKeyConflictError } from './idempotency-keys.repository.js'

describe('InMemoryIdempotencyKeysRepository (DTJ-019, SRS-API-010)', () => {
  it('1. createProcessing → record в статусе processing', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    const r = await repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h1' })
    expect(r.status).toBe('processing')
    expect(r.responseStatus).toBeNull()
  })

  it('2. findByTriple возвращает запись', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    await repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h1' })
    const r = await repo.findByTriple('u1', 'POST /x', 'k1')
    expect(r).not.toBeNull()
    expect(r?.requestHash).toBe('h1')
  })

  it('3. findByTriple для отсутствующей записи → null', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    const r = await repo.findByTriple('u1', 'POST /x', 'k-absent')
    expect(r).toBeNull()
  })

  it('4. duplicate createProcessing → IdempotencyKeyConflictError', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    await repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h1' })
    await expect(
      repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h2' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError)
  })

  it('5. разные userId не конфликтуют', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    await repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h1' })
    const r2 = await repo.createProcessing({
      userId: 'u2',
      endpoint: 'POST /x',
      key: 'k1',
      requestHash: 'h1',
    })
    expect(r2.id).not.toBe('u1')
  })

  it('6. markCompleted → статус completed + response сохранён', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    const r = await repo.createProcessing({ userId: 'u1', endpoint: 'POST /x', key: 'k1', requestHash: 'h1' })
    await repo.markCompleted(r.id, 201, { data: { id: 'x' } })
    const after = await repo.findByTriple('u1', 'POST /x', 'k1')
    expect(after?.status).toBe('completed')
    expect(after?.responseStatus).toBe(201)
    expect(after?.responseBody).toEqual({ data: { id: 'x' } })
  })

  it('7. markCompleted с несуществующим id → throws', async () => {
    const repo = new InMemoryIdempotencyKeysRepository()
    await expect(repo.markCompleted('nonexistent', 200, { data: null })).rejects.toThrow(
      'idempotency record not found',
    )
  })
})
