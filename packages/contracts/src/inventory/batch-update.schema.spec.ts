/**
 * Unit-тест zod-контракта `POST /api/v1/inventory/batch-update` (SRS-INV-001..011).
 * Стиль/структура — по образцу `search.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  inventoryBatchItemSchema,
  inventoryBatchUpdateRequestSchema,
  inventorySyncChannelSchema,
  inventorySyncTypeSchema,
} from './batch-update.schema.js'

describe('inventorySyncTypeSchema', () => {
  it.each(['delta', 'full'] as const)('%s — допустимое значение', (value) => {
    expect(inventorySyncTypeSchema.parse(value)).toBe(value)
  })

  it('недопустимое значение → ZodError', () => {
    expect(inventorySyncTypeSchema.safeParse('partial').success).toBe(false)
  })
})

describe('inventorySyncChannelSchema', () => {
  it.each(['rest_api', 'excel_import', 'manual_entry'] as const)('%s — допустимое значение', (value) => {
    expect(inventorySyncChannelSchema.parse(value)).toBe(value)
  })

  it('недопустимое значение → ZodError', () => {
    expect(inventorySyncChannelSchema.safeParse('csv_import').success).toBe(false)
  })
})

const validItem = {
  internal_sku: 'SKU-001',
  raw_trade_name: 'Paracetamol 500mg',
  price_diram: 1500,
  quantity: 10,
  expires_at: '2030-01-01',
}

describe('inventoryBatchItemSchema', () => {
  it('минимально валидный элемент проходит', () => {
    expect(inventoryBatchItemSchema.parse(validItem)).toEqual(validItem)
  })

  it.each([
    ['7 символов — короче минимума (8)', '1234567', false],
    ['8 символов — минимум', '12345678', true],
    ['32 символа — максимум', '1'.repeat(32), true],
    ['33 символа — длиннее максимума', '1'.repeat(33), false],
  ])('raw_barcode: %s', (_label, value, shouldPass) => {
    expect(inventoryBatchItemSchema.safeParse({ ...validItem, raw_barcode: value }).success).toBe(shouldPass)
  })

  it('raw_barcode пустая строка трансформируется в null', () => {
    expect(inventoryBatchItemSchema.parse({ ...validItem, raw_barcode: '' }).raw_barcode).toBeNull()
  })

  it('raw_barcode отсутствует/null — валидно', () => {
    expect(inventoryBatchItemSchema.parse(validItem).raw_barcode).toBeUndefined()
    expect(inventoryBatchItemSchema.parse({ ...validItem, raw_barcode: null }).raw_barcode).toBeNull()
  })

  it.each([
    ['internal_sku', ''.padEnd(0, 'x'), false],
    ['internal_sku', 'x'.repeat(64), true],
    ['internal_sku', 'x'.repeat(65), false],
    ['raw_trade_name', '', false],
    ['raw_trade_name', 'x'.repeat(256), true],
    ['raw_trade_name', 'x'.repeat(257), false],
  ] as const)('%s длина-граница: %s -> success=%s', (field, value, shouldPass) => {
    expect(inventoryBatchItemSchema.safeParse({ ...validItem, [field]: value }).success).toBe(shouldPass)
  })

  it.each([
    ['price_diram', -1, false],
    ['price_diram', 0, true],
    ['price_diram', 1.5, false],
    ['quantity', -1, false],
    ['quantity', 0, true],
    ['quantity', 1.5, false],
  ] as const)('%s=%s (nonnegative int) -> success=%s', (field, value, shouldPass) => {
    expect(inventoryBatchItemSchema.safeParse({ ...validItem, [field]: value }).success).toBe(shouldPass)
  })

  it.each([
    ['2030-01-01', true],
    ['30-01-01', false],
    ['2030/01/01', false],
    ['not-a-date', false],
  ])('expires_at=%s (формат YYYY-MM-DD) -> success=%s', (value, shouldPass) => {
    expect(inventoryBatchItemSchema.safeParse({ ...validItem, expires_at: value }).success).toBe(shouldPass)
  })

  it('опциональные поля (raw_dosage_form/raw_dosage_strength/raw_manufacturer_name/batch_number) можно опустить или задать null', () => {
    const withNulls = {
      ...validItem,
      raw_dosage_form: null,
      raw_dosage_strength: null,
      raw_manufacturer_name: null,
      batch_number: null,
    }
    expect(inventoryBatchItemSchema.parse(withNulls)).toEqual(withNulls)
  })
})

const baseRequest = {
  batch_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sync_type: 'delta' as const,
  items: [validItem],
}

describe('inventoryBatchUpdateRequestSchema', () => {
  it('минимально валидный delta-запрос проходит, is_last_page по умолчанию true', () => {
    const parsed = inventoryBatchUpdateRequestSchema.parse(baseRequest)
    expect(parsed.is_last_page).toBe(true)
  })

  it('batch_id не uuid → ZodError', () => {
    expect(inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, batch_id: 'not-a-uuid' }).success).toBe(false)
  })

  it('items пустой массив → ZodError (min(1))', () => {
    expect(inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, items: [] }).success).toBe(false)
  })

  it('items ровно 1000 элементов — проходит (граница max)', () => {
    const items = Array.from({ length: 1000 }, () => validItem)
    expect(inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, items }).success).toBe(true)
  })

  it('items 1001 элемент — отклоняется (за границей max)', () => {
    const items = Array.from({ length: 1001 }, () => validItem)
    expect(inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, items }).success).toBe(false)
  })

  it('note длиннее 512 символов → ZodError', () => {
    expect(inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, note: 'x'.repeat(513) }).success).toBe(false)
  })

  describe('superRefine: full_sync_session_id зависит от sync_type (SRS-INV-005)', () => {
    it('sync_type=delta и full_sync_session_id задан → ZodError на full_sync_session_id', () => {
      const result = inventoryBatchUpdateRequestSchema.safeParse({
        ...baseRequest,
        sync_type: 'delta',
        full_sync_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('full_sync_session_id'))).toBe(true)
      }
    })

    it('sync_type=full и full_sync_session_id отсутствует → ZodError на full_sync_session_id', () => {
      const result = inventoryBatchUpdateRequestSchema.safeParse({ ...baseRequest, sync_type: 'full' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('full_sync_session_id'))).toBe(true)
      }
    })

    it('sync_type=full и full_sync_session_id задан → проходит', () => {
      const parsed = inventoryBatchUpdateRequestSchema.parse({
        ...baseRequest,
        sync_type: 'full',
        full_sync_session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })
      expect(parsed.sync_type).toBe('full')
    })

    it('sync_type=delta и full_sync_session_id отсутствует → проходит', () => {
      expect(inventoryBatchUpdateRequestSchema.safeParse(baseRequest).success).toBe(true)
    })
  })
})
