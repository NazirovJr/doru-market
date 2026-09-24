import { describe, expect, it } from 'vitest'
import {
  CRITICAL_CATEGORIES,
  CriticalCategoryCannotBeDisabledError,
  NotificationPreference,
  type NotificationPreferenceCreateCommand,
} from './notification-preference.entity.js'

// eslint-disable-next-line no-restricted-globals -- тестовая фикстура (тот же приём, что notification-template.entity.spec.ts)
const NOW = new Date('2026-01-01T00:00:00Z')

function command(overrides?: Partial<NotificationPreferenceCreateCommand>): NotificationPreferenceCreateCommand {
  return {
    userId: 'user-1',
    category: 'promotions',
    channel: 'telegram',
    isEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    ...overrides,
  }
}

function dushanbeMoment(day: 1 | 2, hour: number, minute: number): Date {
  // eslint-disable-next-line no-restricted-globals -- тестовая фикстура: строит UTC-момент по формуле реализации, не системное время
  return new Date(Date.UTC(2026, 0, day, hour, minute, 0) - 5 * 60 * 60 * 1000)
}

describe('NotificationPreference (DTJ-371)', () => {
  describe.each(CRITICAL_CATEGORIES)('критичная категория "%s"', (category) => {
    it('create() бросает CriticalCategoryCannotBeDisabledError при is_enabled=false', () => {
      expect(() => NotificationPreference.create(command({ category, isEnabled: false }), NOW)).toThrow(
        CriticalCategoryCannotBeDisabledError,
      )
    })

    it('create() разрешает is_enabled=true', () => {
      expect(() => NotificationPreference.create(command({ category, isEnabled: true }), NOW)).not.toThrow()
    })

    it('shouldSuppressNow() ВСЕГДА false, даже с заданными тихими часами (SRS-ADM-059)', () => {
      const preference = NotificationPreference.create(
        command({ category, isEnabled: true, quietHoursStart: '22:00:00', quietHoursEnd: '08:00:00' }),
        NOW,
      )
      expect(preference.shouldSuppressNow(dushanbeMoment(1, 23, 0))).toBe(false)
    })
  })

  it('некритичная категория: create() разрешает is_enabled=false', () => {
    expect(() => NotificationPreference.create(command({ category: 'promotions', isEnabled: false }), NOW)).not.toThrow()
  })

  it('тихие часы не заданы (null) — shouldSuppressNow() false независимо от времени', () => {
    const preference = NotificationPreference.create(command({ quietHoursStart: null, quietHoursEnd: null }), NOW)
    expect(preference.shouldSuppressNow(dushanbeMoment(1, 23, 0))).toBe(false)
  })

  describe('переход через полночь (22:00–08:00, TC-ADM-023/024)', () => {
    function overnightPreference(): NotificationPreference {
      return NotificationPreference.create(
        command({ category: 'promotions', quietHoursStart: '22:00:00', quietHoursEnd: '08:00:00' }),
        NOW,
      )
    }

    it('21:59 — вне окна, false', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(1, 21, 59))).toBe(false)
    })

    it('22:00 — граница начала ВКЛЮЧИТЕЛЬНО, true', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(1, 22, 0))).toBe(true)
    })

    it('23:00 — внутри окна (TC-ADM-023), true', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(1, 23, 0))).toBe(true)
    })

    it('02:00 следующих суток — внутри окна ПОСЛЕ полуночи, true', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(2, 2, 0))).toBe(true)
    })

    it('08:00 — граница конца ИСКЛЮЧИТЕЛЬНО, false', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(2, 8, 0))).toBe(false)
    })

    it('08:01 — уже вне окна, false', () => {
      expect(overnightPreference().shouldSuppressNow(dushanbeMoment(2, 8, 1))).toBe(false)
    })
  })

  describe('окно в пределах одних суток (13:00–14:00)', () => {
    function sameDayPreference(): NotificationPreference {
      return NotificationPreference.create(command({ category: 'promotions', quietHoursStart: '13:00:00', quietHoursEnd: '14:00:00' }), NOW)
    }

    it('12:59 — до окна, false', () => {
      expect(sameDayPreference().shouldSuppressNow(dushanbeMoment(1, 12, 59))).toBe(false)
    })

    it('13:00 — граница начала включительно, true', () => {
      expect(sameDayPreference().shouldSuppressNow(dushanbeMoment(1, 13, 0))).toBe(true)
    })

    it('14:00 — граница конца исключительно, false', () => {
      expect(sameDayPreference().shouldSuppressNow(dushanbeMoment(1, 14, 0))).toBe(false)
    })
  })

  it('restore() не повторяет валидацию фабрики (персистентная строка read-back)', () => {
    const preference = NotificationPreference.restore({
      userId: 'user-1',
      category: 'order_updates',
      channel: 'telegram',
      isEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      updatedAt: NOW,
    })
    expect(preference.category).toBe('order_updates')
    expect(preference.isEnabled).toBe(true)
  })
})
