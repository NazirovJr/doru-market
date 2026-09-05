/**
 * Round-trip unit-тесты Zod-контрактов терминала фармацевта (DTJ-300, тест-план тикета): для
 * каждого тела запроса части A — валидные значения проходят, заведомо невалидные (пустой
 * `rawBarcode`, `sealConfirmed` не boolean и т.п.) — `ZodError`. Стиль — по образцу `orders.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  AcceptOrderRequestSchema,
  CompletePickingRequestSchema,
  ProposePartialFulfillmentRequestSchema,
  RECLAIM_ORDER_REASON_VALUES,
  REPORT_ITEM_ISSUE_REASON_VALUES,
  ReclaimOrderRequestSchema,
  RegenerateHandoverOtpRequestSchema,
  ReportItemIssueRequestSchema,
  ScanOrderItemRequestSchema,
} from './orders-pharmacy-terminal.contracts.js'

describe('AcceptOrderRequestSchema (SRS-PHT-007)', () => {
  it('{} — валидное пустое тело', () => {
    expect(AcceptOrderRequestSchema.parse({})).toEqual({})
  })

  it('лишнее поле → ZodError (.strict())', () => {
    expect(() => AcceptOrderRequestSchema.parse({ unexpected: 1 })).toThrow(ZodError)
  })
})

describe('ReclaimOrderRequestSchema (SRS-PHT-010)', () => {
  it.each(RECLAIM_ORDER_REASON_VALUES)('reason=%s — валидное каноническое значение проходит', (reason) => {
    expect(ReclaimOrderRequestSchema.parse({ reason })).toEqual({ reason })
  })

  it('note опционален', () => {
    expect(ReclaimOrderRequestSchema.parse({ reason: 'other', note: 'коллега ушёл в отпуск' })).toEqual({
      reason: 'other',
      note: 'коллега ушёл в отпуск',
    })
  })

  it('reason вне канонического enum → ZodError', () => {
    expect(() => ReclaimOrderRequestSchema.parse({ reason: 'i_am_bored' })).toThrow(ZodError)
  })

  it('reason отсутствует → ZodError', () => {
    expect(() => ReclaimOrderRequestSchema.parse({})).toThrow(ZodError)
  })

  it('note пустая строка → ZodError (min(1))', () => {
    expect(() => ReclaimOrderRequestSchema.parse({ reason: 'other', note: '' })).toThrow(ZodError)
  })
})

describe('ScanOrderItemRequestSchema (SRS-PHT-011)', () => {
  const VALID_BODY = {
    rawBarcode: '4601964000125',
    manualEntry: false,
    scannedBatchNumber: 'L2409A',
    scannedExpiryDate: '2027-03-01',
  }

  it('тело из примера спецификации — валидно целиком', () => {
    expect(ScanOrderItemRequestSchema.parse(VALID_BODY)).toEqual(VALID_BODY)
  })

  it('scannedBatchNumber/scannedExpiryDate отсутствуют — валидация партии пропускается (оба опциональны)', () => {
    const body = { rawBarcode: '4601964000125', manualEntry: false }
    expect(ScanOrderItemRequestSchema.parse(body)).toEqual(body)
  })

  it('rawBarcode пустая строка → ZodError', () => {
    expect(() => ScanOrderItemRequestSchema.parse({ ...VALID_BODY, rawBarcode: '' })).toThrow(ZodError)
  })

  it('rawBarcode отсутствует → ZodError', () => {
    const { rawBarcode: _rawBarcode, ...rest } = VALID_BODY
    expect(() => ScanOrderItemRequestSchema.parse(rest)).toThrow(ZodError)
  })

  it('manualEntry не boolean → ZodError', () => {
    expect(() => ScanOrderItemRequestSchema.parse({ ...VALID_BODY, manualEntry: 'false' })).toThrow(ZodError)
  })

  it('manualEntry: true — ручной ввод, тот же пайплайн валидации (SRS-PHT-016)', () => {
    expect(ScanOrderItemRequestSchema.parse({ ...VALID_BODY, manualEntry: true }).manualEntry).toBe(true)
  })

  it('scannedExpiryDate — не ISO-дата (datetime вместо date) → ZodError', () => {
    expect(() =>
      ScanOrderItemRequestSchema.parse({ ...VALID_BODY, scannedExpiryDate: '2027-03-01T00:00:00Z' }),
    ).toThrow(ZodError)
  })

  it('rawBarcode не EAN-13 (internal_sku, D-06) — Zod-граница НЕ проверяет формат, проходит', () => {
    // Разбор формата (EAN-13 vs internal_sku) — домен (Barcode.parse), не эта Zod-схема.
    expect(ScanOrderItemRequestSchema.parse({ rawBarcode: 'SKU-42', manualEntry: true }).rawBarcode).toBe(
      'SKU-42',
    )
  })
})

describe('ReportItemIssueRequestSchema (SRS-PHT-017)', () => {
  it.each(REPORT_ITEM_ISSUE_REASON_VALUES)(
    'reason=%s — валидное каноническое значение проходит',
    (reason) => {
      expect(ReportItemIssueRequestSchema.parse({ reason })).toEqual({ reason })
    },
  )

  it('reason вне канонического enum → ZodError', () => {
    expect(() => ReportItemIssueRequestSchema.parse({ reason: 'lost_by_courier' })).toThrow(ZodError)
  })

  it('reason отсутствует → ZodError', () => {
    expect(() => ReportItemIssueRequestSchema.parse({})).toThrow(ZodError)
  })
})

describe('ProposePartialFulfillmentRequestSchema (SRS-PHT-019/020)', () => {
  it('{} — валидное пустое тело', () => {
    expect(ProposePartialFulfillmentRequestSchema.parse({})).toEqual({})
  })

  it('лишнее поле → ZodError (.strict())', () => {
    expect(() => ProposePartialFulfillmentRequestSchema.parse({ force: true })).toThrow(ZodError)
  })
})

describe('CompletePickingRequestSchema (SRS-PHT-024/025)', () => {
  it('sealConfirmed: true — валидно', () => {
    expect(CompletePickingRequestSchema.parse({ sealConfirmed: true })).toEqual({ sealConfirmed: true })
  })

  it('sealConfirmed: false — ВАЛИДНО на границе Zod (домен вернёт 400 SEAL_CONFIRMATION_REQUIRED, не ZodError)', () => {
    expect(CompletePickingRequestSchema.parse({ sealConfirmed: false })).toEqual({ sealConfirmed: false })
  })

  it('sealConfirmed не boolean → ZodError', () => {
    expect(() => CompletePickingRequestSchema.parse({ sealConfirmed: 'true' })).toThrow(ZodError)
  })

  it('sealConfirmed отсутствует → ZodError', () => {
    expect(() => CompletePickingRequestSchema.parse({})).toThrow(ZodError)
  })
})

describe('RegenerateHandoverOtpRequestSchema (SRS-PHT-029)', () => {
  it('{} — валидное пустое тело', () => {
    expect(RegenerateHandoverOtpRequestSchema.parse({})).toEqual({})
  })

  it('лишнее поле → ZodError (.strict())', () => {
    expect(() => RegenerateHandoverOtpRequestSchema.parse({ force: true })).toThrow(ZodError)
  })
})
