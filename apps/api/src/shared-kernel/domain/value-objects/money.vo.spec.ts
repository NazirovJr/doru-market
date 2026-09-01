/**
 * `money.vo.spec.ts` (EP-01, DTJ-007) — полное покрытие VO `Money`.
 *
 * Тестовые кейсы (из тест-плана DTJ-007):
 *   - round-trip `fromDbDecimalTjs`/`toDbDecimalTjs` на граничных значениях;
 *   - `add`/`subtract` — одинаковая валюта проходит, разная — `CurrencyMismatchError`;
 *     `subtract`, дающий отрицательный результат, — `InvalidMoneyError`;
 *   - `multiplyByQuantity` — `qty <= 0` и `qty` нецелое — `InvalidMoneyError`;
 *   - `allocate` — 3 кейса с неровным делением, проверка инварианта суммы;
 *   - сравнения — корректность + `CurrencyMismatchError` при разных валютах.
 */
import { describe, expect, it } from 'vitest'
import { CurrencyMismatchError } from '@/shared-kernel/domain/errors/currency-mismatch.error.js'
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'
import { Money } from './money.vo.js'

describe('Money VO (DTJ-007, SRS-DOM-064..068)', () => {
  describe('fromDiram / fromDbDecimalTjs / toDbDecimalTjs — round-trip', () => {
    it('0.00 TJS → 0n dirams → "0.00"', () => {
      const m = Money.fromDbDecimalTjs('0.00')
      expect(m.diram).toBe(0n)
      expect(m.toDbDecimalTjs()).toBe('0.00')
    })

    it('0.01 TJS → 1n dirams → "0.01" (минимальная дробная часть)', () => {
      const m = Money.fromDbDecimalTjs('0.01')
      expect(m.diram).toBe(1n)
      expect(m.toDbDecimalTjs()).toBe('0.01')
    })

    it('99.90 TJS → 9990n dirams → "99.90"', () => {
      const m = Money.fromDbDecimalTjs('99.90')
      expect(m.diram).toBe(9990n)
      expect(m.toDbDecimalTjs()).toBe('99.90')
    })

    it('99999999.99 TJS (макс NUMERIC(10,2)) → round-trip', () => {
      const m = Money.fromDbDecimalTjs('99999999.99')
      expect(m.diram).toBe(9_999_999_999n)
      expect(m.toDbDecimalTjs()).toBe('99999999.99')
    })

    it('"5" без дробной части → 500n dirams', () => {
      const m = Money.fromDbDecimalTjs('5')
      expect(m.diram).toBe(500n)
      expect(m.toDbDecimalTjs()).toBe('5.00')
    })

    it('"5.5" (1 знак) → "5.50" (round-trip с padding)', () => {
      const m = Money.fromDbDecimalTjs('5.5')
      expect(m.diram).toBe(550n)
      expect(m.toDbDecimalTjs()).toBe('5.50')
    })

    it('отрицательная строка → InvalidMoneyError', () => {
      expect((): Money => Money.fromDbDecimalTjs('-1.00')).toThrow(InvalidMoneyError)
    })

    it('> 2 знаков дробной части → InvalidMoneyError', () => {
      expect((): Money => Money.fromDbDecimalTjs('1.234')).toThrow(InvalidMoneyError)
    })

    it('fromDiram(-1n) → InvalidMoneyError', () => {
      expect((): Money => Money.fromDiram(-1n)).toThrow(InvalidMoneyError)
    })
  })

  describe('add / subtract', () => {
    it('500n + 100n = 600n (одинаковая валюта)', () => {
      const sum = Money.fromDiram(500n).add(Money.fromDiram(100n))
      expect(sum.diram).toBe(600n)
    })

    it('500n - 100n = 400n (одинаковая валюта)', () => {
      const diff = Money.fromDiram(500n).subtract(Money.fromDiram(100n))
      expect(diff.diram).toBe(400n)
    })

    it('subtract отрицательный → InvalidMoneyError', () => {
      expect((): Money => Money.fromDiram(100n).subtract(Money.fromDiram(500n))).toThrow(InvalidMoneyError)
    })

    it('add TJS + USD → CurrencyMismatchError', () => {
      expect((): Money => Money.fromDiram(500n, 'TJS').add(Money.fromDiram(100n, 'USD'))).toThrow(
        CurrencyMismatchError,
      )
    })

    it('subtract TJS - USD → CurrencyMismatchError', () => {
      expect((): Money => Money.fromDiram(500n, 'TJS').subtract(Money.fromDiram(100n, 'USD'))).toThrow(
        CurrencyMismatchError,
      )
    })

    it('иммутабельность: исходный Money не меняется после add', () => {
      const original = Money.fromDiram(500n)
      original.add(Money.fromDiram(100n))
      expect(original.diram).toBe(500n)
    })
  })

  describe('multiplyByQuantity', () => {
    it('100n × 3 = 300n', () => {
      const m = Money.fromDiram(100n).multiplyByQuantity(3)
      expect(m.diram).toBe(300n)
    })

    it('qty = 0 → InvalidMoneyError', () => {
      expect((): Money => Money.fromDiram(100n).multiplyByQuantity(0)).toThrow(InvalidMoneyError)
    })

    it('qty = -1 → InvalidMoneyError', () => {
      expect((): Money => Money.fromDiram(100n).multiplyByQuantity(-1)).toThrow(InvalidMoneyError)
    })

    it('qty = 1.5 (нецелое) → InvalidMoneyError', () => {
      expect((): Money => Money.fromDiram(100n).multiplyByQuantity(1.5)).toThrow(InvalidMoneyError)
    })
  })

  describe('allocate (largest-remainder method)', () => {
    it('1000n / [1,1,1] → 334+333+333 (largest remainder даёт +1 первому)', () => {
      const parts = Money.fromDiram(1000n).allocate([1, 1, 1])
      expect(parts.map((p) => p.diram)).toEqual([334n, 333n, 333n])
      const sum = parts.reduce((acc, p) => acc + p.diram, 0n)
      expect(sum).toBe(1000n)
    })

    it('70/30 (сценарий доли курьера D-21): 1000n / [70,30] → 700n+300n', () => {
      const parts = Money.fromDiram(1000n).allocate([70, 30])
      expect(parts.map((p) => p.diram)).toEqual([700n, 300n])
      const sum = parts.reduce((acc, p) => acc + p.diram, 0n)
      expect(sum).toBe(1000n)
    })

    it('100n / [1,2] → 33n+67n (largest remainder, не 33+33=66)', () => {
      const parts = Money.fromDiram(100n).allocate([1, 2])
      expect(parts.map((p) => p.diram)).toEqual([33n, 67n])
      const sum = parts.reduce((acc, p) => acc + p.diram, 0n)
      expect(sum).toBe(100n)
    })

    it('1n / [1,1] → 1n+0n (largest remainder: первый получает +1)', () => {
      const parts = Money.fromDiram(1n).allocate([1, 1])
      expect(parts.map((p) => p.diram)).toEqual([1n, 0n])
      const sum = parts.reduce((acc, p) => acc + p.diram, 0n)
      expect(sum).toBe(1n)
    })

    it('0n / [1,1,1] → [0n, 0n, 0n] (нулевая сумма делится без остатка)', () => {
      const parts = Money.fromDiram(0n).allocate([1, 1, 1])
      expect(parts.map((p) => p.diram)).toEqual([0n, 0n, 0n])
    })

    it('пустой массив ratios → InvalidMoneyError', () => {
      expect((): Money[] => Money.fromDiram(100n).allocate([])).toThrow(InvalidMoneyError)
    })

    it('ratios с нулём → InvalidMoneyError', () => {
      expect((): Money[] => Money.fromDiram(100n).allocate([1, 0, 1])).toThrow(InvalidMoneyError)
    })

    it('отрицательные ratios → InvalidMoneyError', () => {
      expect((): Money[] => Money.fromDiram(100n).allocate([1, -1, 1])).toThrow(InvalidMoneyError)
    })
  })

  describe('сравнения', () => {
    it('500n equals 500n → true (одинаковая валюта)', () => {
      expect(Money.fromDiram(500n).equals(Money.fromDiram(500n))).toBe(true)
    })

    it('500n equals 600n → false', () => {
      expect(Money.fromDiram(500n).equals(Money.fromDiram(600n))).toBe(false)
    })

    it('500n isGreaterThan 300n → true', () => {
      expect(Money.fromDiram(500n).isGreaterThan(Money.fromDiram(300n))).toBe(true)
    })

    it('500n isLessThanOrEqual 500n → true', () => {
      expect(Money.fromDiram(500n).isLessThanOrEqual(Money.fromDiram(500n))).toBe(true)
    })

    it('TJS equals USD → CurrencyMismatchError', () => {
      expect((): boolean => Money.fromDiram(500n, 'TJS').equals(Money.fromDiram(500n, 'USD'))).toThrow(
        CurrencyMismatchError,
      )
    })

    it('TJS isGreaterThan USD → CurrencyMismatchError', () => {
      expect((): boolean =>
        Money.fromDiram(500n, 'TJS').isGreaterThan(Money.fromDiram(500n, 'USD')),
      ).toThrow(CurrencyMismatchError)
    })

    it('isZero, isPositive, isNegative', () => {
      expect(Money.fromDiram(0n).isZero()).toBe(true)
      expect(Money.fromDiram(100n).isPositive()).toBe(true)
      expect(Money.fromDiram(0n).isNegative()).toBe(false)
    })
  })
})
