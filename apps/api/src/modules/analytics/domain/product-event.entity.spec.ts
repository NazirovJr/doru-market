import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import { fixedDate } from '@/shared-kernel/testing/fixtures/fixed-date.fixture.js'
import {
  CLIENT_PRODUCT_EVENT_TYPES,
  PRODUCT_EVENT_TYPES,
  ProductEvent,
  isClientProductEventType,
  type ProductEventCreateCommand,
} from './product-event.entity.js'

const NOW = fixedDate('2026-09-24T10:00:00Z')

function baseCommand(overrides: Partial<ProductEventCreateCommand> = {}): ProductEventCreateCommand {
  return {
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    eventType: 'search_performed',
    ...overrides,
  }
}

describe('ProductEvent.create()', () => {
  it('eventType вне PRODUCT_EVENT_TYPES — бросает ValidationError (АС2 DTJ-378)', () => {
    expect(() => ProductEvent.create(baseCommand({ eventType: 'typo_event' }), NOW)).toThrow(ValidationError)
  })

  it('sessionId отсутствует (пустая строка) — бросает ValidationError (обязательность sessionId, тест-план DTJ-378)', () => {
    expect(() => ProductEvent.create(baseCommand({ sessionId: '' }), NOW)).toThrow(ValidationError)
  })

  it('sessionId состоит только из пробелов — тоже бросает ValidationError', () => {
    expect(() => ProductEvent.create(baseCommand({ sessionId: '   ' }), NOW)).toThrow(ValidationError)
  })

  it.each(PRODUCT_EVENT_TYPES)('eventType="%s" (известный тип) — конструируется без ошибки', (eventType) => {
    const event = ProductEvent.create(baseCommand({ eventType }), NOW)
    expect(event.eventType).toBe(eventType)
  })

  it('userId=NULL допустим (гостевая сессия) — session_id остаётся ключом', () => {
    const event = ProductEvent.create(baseCommand({ userId: null }), NOW)
    expect(event.userId).toBeNull()
    expect(event.sessionId).toBe('session-1')
  })

  it('userId отсутствует в команде — тоже трактуется как гость (null)', () => {
    const event = ProductEvent.create(baseCommand(), NOW)
    expect(event.userId).toBeNull()
  })

  it('occurredAt берётся из аргумента (порта Clock), не из Date.now() (АС1 DTJ-378)', () => {
    const event = ProductEvent.create(baseCommand(), NOW)
    expect(event.occurredAt).toBe(NOW)
  })

  it('опциональные поля по умолчанию — medicineId/pharmacyId/orderId/savingsDiram=null, metadata={}', () => {
    const event = ProductEvent.create(baseCommand(), NOW)
    const snapshot = event.toSnapshot()
    expect(snapshot.medicineId).toBeNull()
    expect(snapshot.pharmacyId).toBeNull()
    expect(snapshot.orderId).toBeNull()
    expect(snapshot.savingsDiram).toBeNull()
    expect(snapshot.metadata).toEqual({})
  })

  it('savingsDiram — снэпшот в bigint (правило 6 AGENTS.md: целые дирамы), сохраняется как есть', () => {
    const event = ProductEvent.create(baseCommand({ eventType: 'analog_shown', savingsDiram: 15_000n }), NOW)
    expect(event.toSnapshot().savingsDiram).toBe(15_000n)
  })

  it('полный набор полей заполняется в снэпшот 1:1', () => {
    const event = ProductEvent.create(
      baseCommand({
        eventType: 'added_to_cart',
        userId: 'user-1',
        medicineId: 'medicine-1',
        pharmacyId: 'pharmacy-1',
        orderId: 'order-1',
        savingsDiram: 5_000n,
        metadata: { source: 'catalog_card' },
      }),
      NOW,
    )
    expect(event.toSnapshot()).toEqual({
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'session-1',
      eventType: 'added_to_cart',
      medicineId: 'medicine-1',
      pharmacyId: 'pharmacy-1',
      orderId: 'order-1',
      savingsDiram: 5_000n,
      metadata: { source: 'catalog_card' },
      occurredAt: NOW,
    })
  })
})

describe('CLIENT_PRODUCT_EVENT_TYPES / isClientProductEventType()', () => {
  it('order_placed исключён из клиентского набора (DTJ-379: пишет только сервер)', () => {
    expect(CLIENT_PRODUCT_EVENT_TYPES).not.toContain('order_placed')
    expect(isClientProductEventType('order_placed')).toBe(false)
  })

  it.each(CLIENT_PRODUCT_EVENT_TYPES)('eventType="%s" — клиентский тип допустим', (eventType) => {
    expect(isClientProductEventType(eventType)).toBe(true)
  })

  it('незнакомый тип — тоже не клиентский', () => {
    expect(isClientProductEventType('typo_event')).toBe(false)
  })
})
