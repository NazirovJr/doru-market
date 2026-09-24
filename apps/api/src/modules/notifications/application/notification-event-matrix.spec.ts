import { describe, expect, it } from 'vitest'
import { NOTIFICATION_EVENT_MATRIX } from './notification-event-matrix.js'

describe('notification-event-matrix (реэкспорт apps/api над @dorutj/contracts)', () => {
  it('каждое событие имеет непустой channels, включающий in_app', () => {
    for (const entry of NOTIFICATION_EVENT_MATRIX) {
      expect(entry.channels.length).toBeGreaterThan(0)
      expect(entry.channels).toContain('in_app')
    }
  })
})
