/**
 * `DetectPriceDriftService` — unit-набор (EP-09, DTJ-231 «Тест-план», поправка CTO волна 6):
 * совпадение / расхождение / отсутствие ожидания. Оба аргумента `check()` — сумма ПОЗИЦИЙ
 * (`items_total`, БЕЗ доставки), резолвинг ПО ГРУППЕ (ключ `pharmacyId`) — забота вызывающего
 * кода (`CheckoutUseCase`), не этого сервиса (см. его JSDoc). Чистая функция, без портов/I-O —
 * юнит без моков.
 */
import { describe, expect, it } from 'vitest'
import { DetectPriceDriftService, PRICE_DRIFT_TOLERANCE_DIRAM } from './detect-price-drift.service.js'
import { PriceOrStockChangedError } from './errors/price-or-stock-changed.error.js'

describe('DetectPriceDriftService', () => {
  const service = new DetectPriceDriftService()

  it('PRICE_DRIFT_TOLERANCE_DIRAM — именованная константа, ASSUMPTION 0 (точное совпадение)', () => {
    expect(PRICE_DRIFT_TOLERANCE_DIRAM).toBe(0n)
  })

  it('expectedItemsTotalDiram не передан (null) — проверка пропускается, ничего не бросает', () => {
    expect(() => {
      service.check(null, 12_00n)
    }).not.toThrow()
  })

  it('expectedItemsTotalDiram совпадает с actualItemsTotalDiram — не бросает', () => {
    expect(() => {
      service.check(10_00n, 10_00n)
    }).not.toThrow()
  })

  it('expectedItemsTotalDiram отличается от actualItemsTotalDiram — PriceOrStockChangedError с details.actualTotalDiram', () => {
    expect.assertions(4)
    try {
      service.check(10_00n, 12_00n)
    } catch (error) {
      expect(error).toBeInstanceOf(PriceOrStockChangedError)
      const err = error as PriceOrStockChangedError
      expect(err.code).toBe('PRICE_OR_STOCK_CHANGED')
      expect(err.details?.actualTotalDiram).toBe(1200)
      expect(err.details?.expectedTotalDiram).toBe(1000)
    }
  })

  it('расхождение в МЕНЬШУЮ сторону (цена упала) — тоже бросает, направление роли не играет', () => {
    expect(() => {
      service.check(12_00n, 10_00n)
    }).toThrow(PriceOrStockChangedError)
  })

  it('расхождение РОВНО на 1 дирам — бросает (допуск 0, «больше PRICE_DRIFT_TOLERANCE_DIRAM» — строго >0)', () => {
    expect(() => {
      service.check(10_00n, 10_01n)
    }).toThrow(PriceOrStockChangedError)
  })
})
