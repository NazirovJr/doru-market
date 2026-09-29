import { describe, expect, it, vi } from 'vitest'
import type { AuthSessionsRepository } from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import type { SessionStatus, SessionStatusCachePort } from '@/modules/auth/application/ports/session-status-cache.port.js'
import { SessionStatusService } from './session-status.service.js'

class FakeCache implements SessionStatusCachePort {
  readonly entries = new Map<string, SessionStatus>()

  get(sessionId: string): Promise<SessionStatus | null> {
    return Promise.resolve(this.entries.get(sessionId) ?? null)
  }

  rememberActive(sessionId: string): Promise<void> {
    if (!this.entries.has(sessionId)) this.entries.set(sessionId, 'active')
    return Promise.resolve()
  }

  markRevoked(sessionIds: readonly string[]): Promise<void> {
    for (const id of sessionIds) this.entries.set(id, 'revoked')
    return Promise.resolve()
  }
}

function build(revokedAt: Date | null | 'missing'): {
  service: SessionStatusService
  cache: FakeCache
  findById: ReturnType<typeof vi.fn>
} {
  const cache = new FakeCache()
  const findById = vi.fn(() => Promise.resolve(revokedAt === 'missing' ? null : { revokedAt }))
  const sessions = { findById } as unknown as AuthSessionsRepository
  return { service: new SessionStatusService(cache, sessions), cache, findById }
}

describe('SessionStatusService (DTJ-443)', () => {
  it('активная сессия: промах кэша читает БД один раз, дальше только кэш', async () => {
    const { service, findById } = build(null)

    expect(await service.isRevoked('s1')).toBe(false)
    expect(await service.isRevoked('s1')).toBe(false)
    expect(await service.isRevoked('s1')).toBe(false)

    expect(findById).toHaveBeenCalledTimes(1)
  })

  it('отозванная в БД сессия: true и кэшируется как revoked', async () => {
    const { service, cache, findById } = build(new Date())

    expect(await service.isRevoked('s1')).toBe(true)
    expect(await service.isRevoked('s1')).toBe(true)

    expect(findById).toHaveBeenCalledTimes(1)
    expect(cache.entries.get('s1')).toBe('revoked')
  })

  it('отзыв после кэширования active перекрывает статус без обращения к БД', async () => {
    const { service, cache, findById } = build(null)
    await service.isRevoked('s1')

    await cache.markRevoked(['s1'])

    expect(await service.isRevoked('s1')).toBe(true)
    expect(findById).toHaveBeenCalledTimes(1)
  })

  it('неизвестная сессия не считается отозванной', async () => {
    const { service } = build('missing')

    expect(await service.isRevoked('ghost')).toBe(false)
  })

  it('Redis недоступен: статус берётся из БД, отозванная сессия всё равно отклоняется', async () => {
    const sessions = { findById: vi.fn(() => Promise.resolve({ revokedAt: new Date() })) } as unknown as AuthSessionsRepository
    const brokenCache: SessionStatusCachePort = {
      get: () => Promise.reject(new Error('redis down')),
      rememberActive: () => Promise.reject(new Error('redis down')),
      markRevoked: () => Promise.reject(new Error('redis down')),
    }

    expect(await new SessionStatusService(brokenCache, sessions).isRevoked('s1')).toBe(true)
  })
})
