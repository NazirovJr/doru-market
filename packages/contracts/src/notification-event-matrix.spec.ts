/** DTJ-370 — структурная валидность единственного источника матрицы + утилиты диспетчеризации. */
import { describe, expect, it } from 'vitest'
import {
  findMissingTemplateVariables,
  isKnownUserRole,
  NOTIFICATION_DISPATCH_BACKOFF_MS,
  NOTIFICATION_EVENT_MATRIX,
  renderTemplateString,
  resolveNotificationDispatchBackoffMs,
} from './notifications.js'

describe('NOTIFICATION_EVENT_MATRIX (SRS-ADM-052)', () => {
  it('содержит ровно 15 event_type — тот же счёт, что tests/arch/notification-templates-completeness.spec.ts (DTJ-369)', () => {
    expect(NOTIFICATION_EVENT_MATRIX).toHaveLength(15)
  })

  it('event_type уникальны', () => {
    const eventTypes = NOTIFICATION_EVENT_MATRIX.map((entry) => entry.eventType)
    expect(new Set(eventTypes).size).toBe(eventTypes.length)
  })

  it('каждая запись имеет непустые recipientRoles и channels, все роли — известные UserRole', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(entry.recipientRoles.length).toBeGreaterThan(0)
      expect(entry.channels.length).toBeGreaterThan(0)
      for (const role of entry.recipientRoles) {
        expect(isKnownUserRole(role)).toBe(true)
      }
    }
  })

  it('каждая запись включает in_app ПОСЛЕДНИМ элементом (гарантированный минимум, не участвует в фолбэк-порядке внешних каналов)', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(entry.channels.at(-1)).toBe('in_app')
    }
  })

  it('order.courier_assigned — единственное событие с двумя ролями-получателями (customer + courier)', () => {
    const entry = NOTIFICATION_EVENT_MATRIX.find((e) => e.eventType === 'order.courier_assigned')
    expect(entry?.recipientRoles).toEqual(['customer', 'courier'])
  })
})

describe('resolveNotificationDispatchBackoffMs (SRS-ADM-060)', () => {
  it('2с / 8с / 32с на попытках 1..3', () => {
    expect(resolveNotificationDispatchBackoffMs(1)).toBe(2_000)
    expect(resolveNotificationDispatchBackoffMs(2)).toBe(8_000)
    expect(resolveNotificationDispatchBackoffMs(3)).toBe(32_000)
    expect(NOTIFICATION_DISPATCH_BACKOFF_MS).toEqual([2_000, 8_000, 32_000])
  })

  it('вне диапазона (0 или >3) — не бросает, использует ближайшую границу', () => {
    expect(resolveNotificationDispatchBackoffMs(0)).toBe(2_000)
    expect(resolveNotificationDispatchBackoffMs(99)).toBe(32_000)
  })
})

describe('renderTemplateString / findMissingTemplateVariables', () => {
  it('подставляет все плейсхолдеры', () => {
    expect(renderTemplateString('{{brandName}}: заказ {{orderNumber}} оплачен', { brandName: 'Апрель', orderNumber: '42' })).toBe(
      'Апрель: заказ 42 оплачен',
    )
  })

  it('находит отсутствующие обязательные переменные', () => {
    expect(findMissingTemplateVariables(['brandName', 'orderNumber'], { brandName: 'Апрель' })).toEqual(['orderNumber'])
  })

  it('все переменные на месте — пустой список отсутствующих', () => {
    expect(findMissingTemplateVariables(['brandName'], { brandName: 'Апрель' })).toEqual([])
  })
})
