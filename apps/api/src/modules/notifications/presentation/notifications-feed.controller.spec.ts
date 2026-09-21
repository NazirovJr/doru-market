/**
 * Unit-тест `NotificationsFeedController` (DTJ-372).
 */
import { describe, expect, it, vi } from 'vitest'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { NotificationSummary } from '@dorutj/contracts'
import type { ListOwnNotificationsUseCase } from '../application/use-cases/list-own-notifications.use-case.js'
import { NotificationsFeedController } from './notifications-feed.controller.js'

describe('NotificationsFeedController', () => {
  it('курьер (courier) получает ответ, а не отказ: эндпоинт универсален для всех шести ролей', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      items: [] as NotificationSummary[],
      nextCursor: null,
      hasMore: false,
    })
    const useCaseMock = { execute: executeMock } as unknown as ListOwnNotificationsUseCase
    const controller = new NotificationsFeedController(useCaseMock)

    const claims = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'courier',
    } as JwtClaims

    const query = { limit: 20, cursor: undefined }

    await expect(
      controller.list(query, claims),
    ).resolves.not.toThrow()

    expect(executeMock).toHaveBeenCalled()
  })

  it('ответ завёрнут в ok(...) и несёт pagination с полями nextCursor, hasMore, limit', async () => {
    const executeMock = vi.fn().mockResolvedValue({
      items: [] as NotificationSummary[],
      nextCursor: null,
      hasMore: false,
    })
    const useCaseMock = { execute: executeMock } as unknown as ListOwnNotificationsUseCase
    const controller = new NotificationsFeedController(useCaseMock)

    const claims = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'customer',
    } as JwtClaims

    const query = { limit: 20, cursor: undefined }

    const result = await controller.list(query, claims)

    expect('data' in result).toBe(true)
    expect('meta' in result).toBe(true)
    expect(result.meta?.pagination).toBeDefined()
    expect(result.meta?.pagination?.nextCursor).toBeNull()
    expect(result.meta?.pagination?.hasMore).toBe(false)
    expect(result.meta?.pagination?.limit).toBe(20)
  })
})
