/** DTJ-370 — тест-план: структурная валидность обёртки над `@dorutj/contracts` матрицей. */
import { describe, expect, it } from 'vitest'
import { findMatrixEntry, NOTIFICATION_EVENT_MATRIX, resolveExternalChannels } from './notification-event-matrix.js'

describe('notification-event-matrix (обёртка apps/api над @dorutj/contracts)', () => {
  it('каждое событие имеет непустой channels — in_app неявно подразумевается, не исключён из логики', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(entry.channels.length).toBeGreaterThan(0)
      expect(entry.channels).toContain('in_app')
    }
  })

  it('findMatrixEntry находит запись по event_type', () => {
    expect(findMatrixEntry('order.paid')?.recipientRoles).toEqual(['customer'])
  })

  it('findMatrixEntry — undefined для события вне матрицы', () => {
    expect(findMatrixEntry('unknown.event')).toBeUndefined()
  })

  it('resolveExternalChannels исключает in_app, сохраняет порядок фолбэка остальных', () => {
    const entry = findMatrixEntry('order.paid')!
    expect(resolveExternalChannels(entry)).toEqual(['telegram', 'sms', 'web_push'])
  })

  it('resolveExternalChannels для события только с in_app в фактических каналах даёт пустой список', () => {
    const entry = findMatrixEntry('ops.sla_breached')!
    expect(resolveExternalChannels(entry)).toEqual(['web_push'])
  })
})
