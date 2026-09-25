import { describe, expect, it } from 'vitest'
import { listEventsWithExternalFallback, NOTIFICATION_EVENT_MATRIX, resolveLastExternalChannel } from './notification-event-matrix.js'

describe('notification-event-matrix (реэкспорт apps/api над @dorutj/contracts)', () => {
  it('каждое событие имеет непустой channels, включающий in_app', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(entry.channels.length).toBeGreaterThan(0)
      expect(entry.channels).toContain('in_app')
    }
  })
})

describe('resolveLastExternalChannel/listEventsWithExternalFallback (DTJ-373)', () => {
  it('никогда не возвращает in_app — критерий приёмки 2: in_app не может быть сигналом недоставленности', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(resolveLastExternalChannel(entry.eventType)).not.toBe('in_app')
    }
  })

  it('order.paid → web_push (последний перед in_app в его цепочке telegram→sms→web_push→in_app)', () => {
    expect(resolveLastExternalChannel('order.paid')).toBe('web_push')
  })

  it('prescription.decision → telegram (цепочка telegram→in_app, единственный внешний канал)', () => {
    expect(resolveLastExternalChannel('prescription.decision')).toBe('telegram')
  })

  it('неизвестный eventType — null (события нет в матрице)', () => {
    expect(resolveLastExternalChannel('unknown.event')).toBeNull()
  })

  it('listEventsWithExternalFallback — по одной паре на каждое из 15 событий матрицы (у всех есть внешний канал)', () => {
    const pairs = listEventsWithExternalFallback()
    expect(pairs).toHaveLength(NOTIFICATION_EVENT_MATRIX.length)
    expect(pairs.map((p) => p.eventType).sort()).toEqual(NOTIFICATION_EVENT_MATRIX.map((e) => e.eventType).sort())
  })
})
