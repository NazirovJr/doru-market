/**
 * Unit-тест `notification-summary.mapper.ts` (DTJ-372).
 */
import { describe, expect, it } from 'vitest'
import { NotificationSummarySchema } from '@dorutj/contracts'
import { toNotificationSummary } from './notification-summary.mapper.js'
import type { NotificationRecord } from '../application/ports/notifications-repository.port.js'

describe('toNotificationSummary', () => {
  it('полная запись → toStrictEqual с DTO ровно из семи полей', () => {
    const record: NotificationRecord = {
      id: 'notification-1',
      eventType: 'order_ready',
      channel: 'in_app',
      status: 'queued',
      payload: { subject: 'Заказ готов', body: 'Ваш заказ №123 готов к выдаче' },
      sentAt: new Date('2026-09-04T10:00:00.000Z'),
      createdAt: new Date('2026-09-04T10:00:00.000Z'),
      userId: 'user-1',
      tenantId: 'tenant-1',
      failedReason: null,
    }
    const summary = toNotificationSummary(record)
    expect(summary).toStrictEqual({
      id: 'notification-1',
      eventType: 'order_ready',
      channel: 'in_app',
      status: 'queued',
      payload: { subject: 'Заказ готов', body: 'Ваш заказ №123 готов к выдаче' },
      sentAt: '2026-09-04T10:00:00.000Z',
      createdAt: '2026-09-04T10:00:00.000Z',
    })
    const parsed = NotificationSummarySchema.safeParse(summary)
    expect(parsed.success).toBe(true)
  })

  it('запись без eventType и без subject → eventType: null, payload: { body }', () => {
    const record: NotificationRecord = {
      id: 'notification-1',
      channel: 'in_app',
      status: 'queued',
      payload: { body: 'Готов к выдаче' },
      sentAt: null,
      createdAt: new Date('2026-09-04T10:00:00.000Z'),
      userId: 'user-1',
      tenantId: 'tenant-1',
      failedReason: null,
    }
    const summary = toNotificationSummary(record)
    expect(summary).toStrictEqual({
      id: 'notification-1',
      eventType: null,
      channel: 'in_app',
      status: 'queued',
      payload: { body: 'Готов к выдаче' },
      sentAt: null,
      createdAt: '2026-09-04T10:00:00.000Z',
    })
    const parsed = NotificationSummarySchema.safeParse(summary)
    expect(parsed.success).toBe(true)
  })
})
