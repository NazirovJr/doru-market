import { describe, expect, it } from 'vitest'
import { NoopOutboxReaderAdapter } from './noop-outbox-reader.adapter.js'

describe('NoopOutboxReaderAdapter', () => {
  it('readPending всегда возвращает пустой список независимо от limit', async () => {
    const adapter = new NoopOutboxReaderAdapter()

    await expect(adapter.readPending(100)).resolves.toEqual([])
  })

  it('markPublished успешно резолвится, ничего не делая', async () => {
    const adapter = new NoopOutboxReaderAdapter()

    await expect(adapter.markPublished('evt-1')).resolves.toBeUndefined()
  })
})
