import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevokeExpiredRotatedKeysJob, type ExpiredRotatedKey, type ExpiredRotatedKeyScannerPort } from './revoke-expired-rotated-keys.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'

function fakeScanner(keys: readonly ExpiredRotatedKey[]): ExpiredRotatedKeyScannerPort {
  return { findExpiredRotatedKeys: vi.fn<ExpiredRotatedKeyScannerPort['findExpiredRotatedKeys']>().mockResolvedValue(keys) }
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data }) } as unknown as Response
}

const KEY_A: ExpiredRotatedKey = { keyId: 'key-a' }
const KEY_B: ExpiredRotatedKey = { keyId: 'key-b' }

describe('RevokeExpiredRotatedKeysJob (DTJ-365)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('ключ с истёкшим грейс-периодом отзывается через HTTP-мост', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ revoked: true }))
    const job = new RevokeExpiredRotatedKeysJob(fakeScanner([KEY_A]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce(new Date('2026-09-04T03:00:00.000Z'))

    expect(result).toEqual({ scanned: 1, revoked: 1, skipped: 0 })
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL('/api/v1/internal/pharmacy-api-keys/key-a/revoke-expired', API_INTERNAL_URL))
    expect(call[1].method).toBe('POST')
    expect((call[1].headers as Record<string, string>)['x-internal-api-key']).toBe(INTERNAL_API_KEY)
  })

  it('пустой скан — fetch не вызывается', async () => {
    const job = new RevokeExpiredRotatedKeysJob(fakeScanner([]), API_INTERNAL_URL, INTERNAL_API_KEY)

    await expect(job.runOnce()).resolves.toEqual({ scanned: 0, revoked: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('гонка — ключ уже отозван к моменту вызова — revoked:false учитывается как skipped', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ revoked: false }))
    const job = new RevokeExpiredRotatedKeysJob(fakeScanner([KEY_A]), API_INTERNAL_URL, INTERNAL_API_KEY)

    await expect(job.runOnce()).resolves.toEqual({ scanned: 1, revoked: 0, skipped: 1 })
  })

  it('один вызов падает (сеть/5xx) — остальные ключи того же тика обрабатываются (Promise.allSettled)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      url.pathname.includes('key-a')
        ? Promise.resolve(jsonResponse({}, false, 500))
        : Promise.resolve(jsonResponse({ revoked: true })),
    )
    const job = new RevokeExpiredRotatedKeysJob(fakeScanner([KEY_A, KEY_B]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result.scanned).toBe(2)
    expect(result.revoked).toBe(1)
  })

  it('INTERNAL_API_KEY не настроен — тик не падает, fetch не вызывается', async () => {
    const job = new RevokeExpiredRotatedKeysJob(fakeScanner([KEY_A]), API_INTERNAL_URL, undefined)

    await expect(job.runOnce()).resolves.toEqual({ scanned: 1, revoked: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
