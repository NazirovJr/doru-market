/** `UpdateUserPreferencesUseCase` (DTJ-371) — массовый PATCH, тихое игнорирование is_enabled критичной категории (критерий приёмки №3). */
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { NotificationPreferencesRepositoryPort } from '../ports/notification-preferences-repository.port.js'
import type { Clock } from '@/shared-kernel/index.js'
import { NotificationPreference } from '../../domain/notification-preference.entity.js'
import { UpdateUserPreferencesUseCase } from './update-user-preferences.use-case.js'

const NOW = new Date('2026-01-01T00:00:00Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

interface Harness {
  readonly useCase: UpdateUserPreferencesUseCase
  readonly findByUserCategoryChannel: ReturnType<typeof vi.fn>
  readonly upsert: ReturnType<typeof vi.fn>
}

function buildHarness(existing?: readonly NotificationPreference[]): Harness {
  const byKey = new Map((existing ?? []).map((p) => [`${p.category}:${p.channel}`, p]))
  const findByUserCategoryChannel = vi.fn().mockImplementation((_userId: string, category: string, channel: string) => {
    return Promise.resolve(byKey.get(`${category}:${channel}`) ?? null)
  })
  const upsert = vi.fn().mockImplementation((preference: NotificationPreference) => Promise.resolve(preference))
  const repository: NotificationPreferencesRepositoryPort = { findByUserCategoryChannel, listByUser: vi.fn(), upsert }
  const useCase = new UpdateUserPreferencesUseCase(repository, new FixedClock())
  return { useCase, findByUserCategoryChannel, upsert }
}

describe('UpdateUserPreferencesUseCase (DTJ-371)', () => {
  it('новая позиция без существующей строки — is_enabled=true и quietHours=null по умолчанию', async () => {
    const h = buildHarness()

    const [result] = await h.useCase.execute({ userId: 'user-1', rawPatch: { preferences: [{ category: 'promotions', channel: 'telegram' }] } })

    expect(result?.isEnabled).toBe(true)
    expect(result?.quietHoursStart).toBeNull()
    expect(h.upsert).toHaveBeenCalledOnce()
  })

  it('явные значения применяются: is_enabled=false + тихие часы для некритичной категории', async () => {
    const h = buildHarness()

    const [result] = await h.useCase.execute({
      userId: 'user-1',
      rawPatch: { preferences: [{ category: 'promotions', channel: 'telegram', isEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00' }] },
    })

    expect(result).toMatchObject({ isEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00' })
  })

  it('критерий приёмки №3: is_enabled=false для order_updates ИГНОРИРУЕТСЯ (не бросает), остальная позиция патча применяется', async () => {
    const h = buildHarness()

    const results = await h.useCase.execute({
      userId: 'user-1',
      rawPatch: {
        preferences: [
          { category: 'order_updates', channel: 'telegram', isEnabled: false },
          { category: 'promotions', channel: 'sms', quietHoursStart: '23:00', quietHoursEnd: '07:00' },
        ],
      },
    })

    expect(results).toHaveLength(2)
    const orderUpdates = results.find((p) => p.category === 'order_updates')
    const promotions = results.find((p) => p.category === 'promotions')
    expect(orderUpdates?.isEnabled).toBe(true)
    expect(promotions?.quietHoursStart).toBe('23:00')
  })

  it('delivery_otp — тоже критичная категория, is_enabled принудительно true', async () => {
    const h = buildHarness()

    const [result] = await h.useCase.execute({
      userId: 'user-1',
      rawPatch: { preferences: [{ category: 'delivery_otp', channel: 'sms', isEnabled: false }] },
    })

    expect(result?.isEnabled).toBe(true)
  })

  it('частичное обновление: не переданное поле сохраняет прежнее значение существующей строки', async () => {
    const existing = NotificationPreference.restore({
      userId: 'user-1',
      category: 'promotions',
      channel: 'telegram',
      isEnabled: false,
      quietHoursStart: '22:00:00',
      quietHoursEnd: '08:00:00',
      updatedAt: NOW,
    })
    const h = buildHarness([existing])

    const [result] = await h.useCase.execute({
      userId: 'user-1',
      rawPatch: { preferences: [{ category: 'promotions', channel: 'telegram', quietHoursEnd: '09:00' }] },
    })

    expect(result).toMatchObject({ isEnabled: false, quietHoursStart: '22:00:00', quietHoursEnd: '09:00' })
  })

  it('явный null очищает ранее заданные тихие часы', async () => {
    const existing = NotificationPreference.restore({
      userId: 'user-1',
      category: 'promotions',
      channel: 'telegram',
      isEnabled: true,
      quietHoursStart: '22:00:00',
      quietHoursEnd: '08:00:00',
      updatedAt: NOW,
    })
    const h = buildHarness([existing])

    const [result] = await h.useCase.execute({
      userId: 'user-1',
      rawPatch: { preferences: [{ category: 'promotions', channel: 'telegram', quietHoursStart: null, quietHoursEnd: null }] },
    })

    expect(result?.quietHoursStart).toBeNull()
    expect(result?.quietHoursEnd).toBeNull()
  })

  it('невалидный channel — ValidationError, repository не тронут', async () => {
    const h = buildHarness()

    await expect(
      h.useCase.execute({ userId: 'user-1', rawPatch: { preferences: [{ category: 'promotions', channel: 'carrier_pigeon' }] } }),
    ).rejects.toThrow(ValidationError)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('невалидный формат quietHoursStart ("25:00") — ValidationError', async () => {
    const h = buildHarness()

    await expect(
      h.useCase.execute({
        userId: 'user-1',
        rawPatch: { preferences: [{ category: 'promotions', channel: 'telegram', quietHoursStart: '25:00' }] },
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('пустой массив preferences — ValidationError (min(1))', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute({ userId: 'user-1', rawPatch: { preferences: [] } })).rejects.toThrow(ValidationError)
  })
})
