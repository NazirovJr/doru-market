/**
 * Unit-тесты `calculateVat` (DTJ-251, AC3 тикета + «Unit: расчёт НДС/total_diram — граничные
 * значения округления дирамов» тест-плана). Граничные случаи «ровно половина дирама» подобраны
 * так, чтобы banker's rounding (round half to even) реально ветвился в обе стороны — не просто
 * «формула похожа на правильную».
 */
import { describe, expect, it } from 'vitest'
import { calculateVat, CASH_COMMISSION_VAT_RATE_BPS } from './cash-commission-vat.util.js'

describe('calculateVat (DTJ-251)', () => {
  it('AC3: subtotal=100000 → vat=14000, total=114000 (буквальный пример тикета)', () => {
    expect(calculateVat(100_000n)).toEqual({ vatDiram: 14_000n, totalDiram: 114_000n })
  })

  it('CASH_COMMISSION_VAT_RATE_BPS=1400 (14.00%) — именованная константа, не буквальный 0.14 в формуле', () => {
    expect(CASH_COMMISSION_VAT_RATE_BPS).toBe(1_400n)
  })

  it('subtotal=0 → vat=0, total=0 (сеть без комиссии за период — легальный вход)', () => {
    expect(calculateVat(0n)).toEqual({ vatDiram: 0n, totalDiram: 0n })
  })

  it('граница «ровно половина дирама», частное НЕЧЁТНОЕ (3) — округление ВВЕРХ до чётного (4): subtotal=25 → 25×1400/10000=3.5', () => {
    expect(calculateVat(25n)).toEqual({ vatDiram: 4n, totalDiram: 29n })
  })

  it('граница «ровно половина дирама», частное ЧЁТНОЕ (10) — округление ВНИЗ, остаётся чётным: subtotal=75 → 75×1400/10000=10.5', () => {
    expect(calculateVat(75n)).toEqual({ vatDiram: 10n, totalDiram: 85n })
  })

  it('НЕ ровно половина, дробная часть < 0.5 — округление вниз: subtotal=10 → 10×1400/10000=1.4', () => {
    expect(calculateVat(10n)).toEqual({ vatDiram: 1n, totalDiram: 11n })
  })

  it('НЕ ровно половина, дробная часть > 0.5 — округление вверх: subtotal=13 → 13×1400/10000=1.82', () => {
    expect(calculateVat(13n)).toEqual({ vatDiram: 2n, totalDiram: 15n })
  })

  it('totalDiram === subtotalDiram + vatDiram на КАЖДОМ входе (инвариант БД chk_billing_invoices_total_matches)', () => {
    for (const subtotal of [0n, 1n, 25n, 75n, 100_000n, 999_999n, 1_234_567n]) {
      const { vatDiram, totalDiram } = calculateVat(subtotal)
      expect(totalDiram).toBe(subtotal + vatDiram)
    }
  })

  it('большие суммы (без переполнения — bigint) — subtotal=1_000_000_000 → vat=140_000_000', () => {
    expect(calculateVat(1_000_000_000n)).toEqual({ vatDiram: 140_000_000n, totalDiram: 1_140_000_000n })
  })
})
