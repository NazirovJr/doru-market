/**
 * Unit-тест `CancelOrderRequestSchema` (EP-09, DTJ-232, AC5, SRS-ORD-030). Стиль — по образцу
 * `onboarding.spec.ts` (`SuspendPharmacyRequestSchema`): таблица валидных значений enum'а +
 * отклонение произвольной строки/значения вне подмножества.
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { CANCEL_ORDER_REASON_VALUES, CancelOrderRequestSchema, CreateOrderRequestSchema } from './orders.js'

describe('CancelOrderRequestSchema', () => {
  it.each(CANCEL_ORDER_REASON_VALUES)('reason=%s — валидное каноническое значение проходит', (reason) => {
    expect(CancelOrderRequestSchema.parse({ reason })).toEqual({ reason })
  })

  it('AC5: reason вне канонического enum → ZodError (400 на границе presentation, не доменная ошибка)', () => {
    expect(() => CancelOrderRequestSchema.parse({ reason: 'i_just_changed_my_mind' })).toThrow(ZodError)
  })

  it('reason из ПОЛНОГО доменного enum, но системного (payment_timeout) — НЕ проходит: недоступен человеку через этот эндпоинт', () => {
    expect(() => CancelOrderRequestSchema.parse({ reason: 'payment_timeout' })).toThrow(ZodError)
  })

  it('reason отсутствует → ZodError', () => {
    expect(() => CancelOrderRequestSchema.parse({})).toThrow(ZodError)
  })
})

/**
 * `CreateOrderRequestSchema` (SRS-ORD-017/023, «Поправка CTO волна 6») — `POST /api/v1/orders`,
 * перенесено сюда из `apps/api/.../orders/presentation/checkout/dto/create-order-request.dto.ts`.
 * Фокус этого набора — `expectedTotalDiramByPharmacy`: объект по группам, а НЕ одно число.
 */
describe('CreateOrderRequestSchema', () => {
  const MINIMAL_BODY = {
    cartItemIds: ['11111111-1111-4111-8111-111111111111'],
    paymentMethod: 'cash_courier',
  }

  it('expectedTotalDiramByPharmacy отсутствует — поле опционально целиком, тело всё равно валидно', () => {
    expect(() => CreateOrderRequestSchema.parse(MINIMAL_BODY)).not.toThrow()
    expect(CreateOrderRequestSchema.parse(MINIMAL_BODY).expectedTotalDiramByPharmacy).toBeUndefined()
  })

  it('expectedTotalDiramByPharmacy с несколькими ключами (pharmacyId) — все проходят как есть', () => {
    const body = {
      ...MINIMAL_BODY,
      expectedTotalDiramByPharmacy: { 'pharmacy-a': 10_000, 'pharmacy-b': 5_000 },
    }
    expect(CreateOrderRequestSchema.parse(body).expectedTotalDiramByPharmacy).toEqual({
      'pharmacy-a': 10_000,
      'pharmacy-b': 5_000,
    })
  })

  it('значение внутри expectedTotalDiramByPharmacy — дробное (не целые дирамы) → ZodError (правило 6 AGENTS.md)', () => {
    expect(() =>
      CreateOrderRequestSchema.parse({ ...MINIMAL_BODY, expectedTotalDiramByPharmacy: { 'pharmacy-a': 10.5 } }),
    ).toThrow(ZodError)
  })

  it('значение внутри expectedTotalDiramByPharmacy — отрицательное → ZodError', () => {
    expect(() =>
      CreateOrderRequestSchema.parse({ ...MINIMAL_BODY, expectedTotalDiramByPharmacy: { 'pharmacy-a': -1 } }),
    ).toThrow(ZodError)
  })

  it('cartItemIds пуст → ZodError (минимум одна позиция)', () => {
    expect(() => CreateOrderRequestSchema.parse({ ...MINIMAL_BODY, cartItemIds: [] })).toThrow(ZodError)
  })
})
