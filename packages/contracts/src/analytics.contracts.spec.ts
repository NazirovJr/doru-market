import { describe, expect, it } from 'vitest'
import { FunnelQuerySchema, ProductEventInputSchema, ProductEventsBatchSchema } from './analytics.js'

const VALID_MEDICINE_ID = '11111111-1111-4111-8111-111111111111'

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventType: 'search_performed',
    sessionId: 'session-1',
    ...overrides,
  }
}

describe('ProductEventInputSchema', () => {
  it('минимальное валидное событие (только eventType+sessionId) проходит', () => {
    const parsed = ProductEventInputSchema.parse(validEvent())
    expect(parsed.eventType).toBe('search_performed')
    expect(parsed.medicineId).toBeUndefined()
  })

  it('ещё-неизвестный eventType (версионный рассинхрон клиент/сервер) НЕ отклоняется на уровне Zod (АС3 DTJ-379 — отклоняется доменом, не контрактом)', () => {
    const result = ProductEventInputSchema.safeParse(validEvent({ eventType: 'unknown_future_event' }))
    expect(result.success).toBe(true)
  })

  it('пустой eventType отклоняется', () => {
    expect(ProductEventInputSchema.safeParse(validEvent({ eventType: '' })).success).toBe(false)
  })

  it('sessionId отсутствует — отклоняется', () => {
    const { sessionId: _sessionId, ...rest } = validEvent()
    expect(ProductEventInputSchema.safeParse(rest).success).toBe(false)
  })

  it('medicineId/pharmacyId — валидный UUID принимается', () => {
    const parsed = ProductEventInputSchema.parse(validEvent({ medicineId: VALID_MEDICINE_ID }))
    expect(parsed.medicineId).toBe(VALID_MEDICINE_ID)
  })

  it('medicineId не-UUID — отклоняется', () => {
    expect(ProductEventInputSchema.safeParse(validEvent({ medicineId: 'not-a-uuid' })).success).toBe(false)
  })

  it('referenceMedicineId — валидный UUID принимается (DTJ-385)', () => {
    const parsed = ProductEventInputSchema.parse(validEvent({ referenceMedicineId: VALID_MEDICINE_ID }))
    expect(parsed.referenceMedicineId).toBe(VALID_MEDICINE_ID)
  })

  it('savingsDiram — целое неотрицательное принимается', () => {
    const parsed = ProductEventInputSchema.parse(validEvent({ savingsDiram: 15_000 }))
    expect(parsed.savingsDiram).toBe(15_000)
  })

  it('savingsDiram дробное — отклоняется (правило 6 AGENTS.md: целые дирамы)', () => {
    expect(ProductEventInputSchema.safeParse(validEvent({ savingsDiram: 15_000.5 })).success).toBe(false)
  })

  it('savingsDiram отрицательное — отклоняется', () => {
    expect(ProductEventInputSchema.safeParse(validEvent({ savingsDiram: -1 })).success).toBe(false)
  })

  it('metadata — компактный объект принимается', () => {
    const parsed = ProductEventInputSchema.parse(validEvent({ metadata: { source: 'catalog_card' } }))
    expect(parsed.metadata).toEqual({ source: 'catalog_card' })
  })

  it('metadata — JSON >= 4096 символов отклоняется (защита от неограниченного payload)', () => {
    const bigMetadata = { blob: 'x'.repeat(4096) }
    expect(ProductEventInputSchema.safeParse(validEvent({ metadata: bigMetadata })).success).toBe(false)
  })
})

describe('ProductEventsBatchSchema', () => {
  it('батч из 50 событий — принимается (граница лимита)', () => {
    const events = Array.from({ length: 50 }, () => validEvent())
    expect(ProductEventsBatchSchema.safeParse(events).success).toBe(true)
  })

  it('батч из 51 события — отклоняется (АС2 DTJ-379, превышен .max(50))', () => {
    const events = Array.from({ length: 51 }, () => validEvent())
    expect(ProductEventsBatchSchema.safeParse(events).success).toBe(false)
  })

  it('пустой батч — валиден по форме (0 элементов, контроллер решает, что с этим делать)', () => {
    expect(ProductEventsBatchSchema.safeParse([]).success).toBe(true)
  })

  it('один элемент батча с невалидной формой (нет sessionId) — вся Zod-валидация батча падает (частичный успех — забота use case, не контракта)', () => {
    const events = [validEvent(), { eventType: 'analog_shown' }]
    expect(ProductEventsBatchSchema.safeParse(events).success).toBe(false)
  })
})

describe('FunnelQuerySchema (DTJ-381)', () => {
  const VALID_TENANT_ID = '11111111-1111-4111-8111-111111111111'

  it('period в формате YYYY-MM принимается', () => {
    expect(FunnelQuerySchema.safeParse({ tenantId: VALID_TENANT_ID, period: '2026-08' }).success).toBe(true)
  })

  it('period в формате YYYY-Www (ISO-неделя) принимается', () => {
    expect(FunnelQuerySchema.safeParse({ tenantId: VALID_TENANT_ID, period: '2026-W35' }).success).toBe(true)
  })

  it('period произвольного формата — отклоняется (точный диапазон месяца/недели проверяет apps/api)', () => {
    expect(FunnelQuerySchema.safeParse({ tenantId: VALID_TENANT_ID, period: 'август-2026' }).success).toBe(false)
  })

  it('tenantId не-UUID — отклоняется', () => {
    expect(FunnelQuerySchema.safeParse({ tenantId: 'not-a-uuid', period: '2026-08' }).success).toBe(false)
  })
})
