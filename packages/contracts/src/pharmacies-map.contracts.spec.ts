import { describe, expect, it } from 'vitest'
import { PharmacyMapPinSchema, PharmacyMapQuerySchema, PharmacyMapResponseSchema } from './pharmacies-map'

const VALID_MEDICINE_ID = '11111111-1111-4111-8111-111111111111'
const VALID_PHARMACY_ID = '22222222-2222-4222-8222-222222222222'

describe('PharmacyMapQuerySchema', () => {
  it('разбирает валидный bbox на 4 числа с сохранением порядка lonMin,latMin,lonMax,latMax', () => {
    const parsed = PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9,38.9' })
    expect(parsed.bbox).toEqual({ lonMin: 68.5, latMin: 38.5, lonMax: 68.9, latMax: 38.9 })
  })

  it('medicineId опционален', () => {
    const parsed = PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9,38.9' })
    expect(parsed.medicineId).toBeUndefined()
  })

  it('принимает валидный medicineId (UUID)', () => {
    const parsed = PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9,38.9', medicineId: VALID_MEDICINE_ID })
    expect(parsed.medicineId).toBe(VALID_MEDICINE_ID)
  })

  it('отклоняет medicineId, не являющийся UUID', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9,38.9', medicineId: 'not-a-uuid' })).toThrow()
  })

  it('отклоняет bbox с нечисловыми значениями, ZodError указывает на поле bbox', () => {
    const result = PharmacyMapQuerySchema.safeParse({ bbox: 'a,b,c,d' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['bbox'])
    }
  })

  it('отклоняет bbox с неверным числом полей (меньше 4)', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9' })).toThrow()
  })

  it('отклоняет bbox с неверным числом полей (больше 4)', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.9,38.9,1' })).toThrow()
  })

  it('отклоняет bbox с пропущенной координатой (пустое поле молча не считается нулём)', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,,68.9,38.9' })).toThrow()
  })

  it('отклоняет bbox с lonMin >= lonMax (вырожденный/перевёрнутый прямоугольник)', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.9,38.5,68.5,38.9' })).toThrow()
  })

  it('отклоняет bbox с latMin >= latMax', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,38.9,68.9,38.5' })).toThrow()
  })

  it('отклоняет bbox с lonMin === lonMax (нулевая площадь)', () => {
    expect(() => PharmacyMapQuerySchema.parse({ bbox: '68.5,38.5,68.5,38.9' })).toThrow()
  })
})

describe('PharmacyMapPinSchema', () => {
  it('валидный пин со статическими данными (offer: null, medicineId не запрошен)', () => {
    const pin = {
      pharmacyId: VALID_PHARMACY_ID,
      name: 'Аптека №1',
      lat: 38.5598,
      lon: 68.787,
      isOpenNow: true,
      is24x7: false,
      offer: null,
    }
    expect(PharmacyMapPinSchema.parse(pin)).toEqual(pin)
  })

  it('валидный пин с оффером (medicineId запрошен)', () => {
    const pin = {
      pharmacyId: VALID_PHARMACY_ID,
      name: 'Аптека №1',
      lat: 38.5598,
      lon: 68.787,
      isOpenNow: true,
      is24x7: true,
      offer: {
        priceDiram: 1500,
        stockQuantity: 10,
        lastSyncedAt: '2026-08-30T10:00:00.000Z',
        isStale: false,
      },
    }
    expect(PharmacyMapPinSchema.parse(pin)).toEqual(pin)
  })

  it('отклоняет пин без обязательного поля offer', () => {
    expect(() =>
      PharmacyMapPinSchema.parse({
        pharmacyId: VALID_PHARMACY_ID,
        name: 'Аптека №1',
        lat: 38.5598,
        lon: 68.787,
        isOpenNow: true,
        is24x7: false,
      }),
    ).toThrow()
  })
})

describe('PharmacyMapResponseSchema', () => {
  it('валидирует пустой список пинов', () => {
    expect(PharmacyMapResponseSchema.parse([])).toEqual([])
  })

  it('отклоняет список с невалидным элементом', () => {
    expect(() => PharmacyMapResponseSchema.parse([{ pharmacyId: 'not-a-uuid' }])).toThrow()
  })
})
