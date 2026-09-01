/**
 * `Money` Value Object (EP-01, DTJ-007, Charter §5 D-02, SRS-DOM-064..068,
 * SRS-DB-003) — единственный объект, через который проходит ЛЮБАЯ денежная
 * операция платформы (orders, ledger, billing, courier payout).
 *
 * Хранение — `bigint` дирамов (1 TJS = 100 дирамов). `float`/`Number`/`parseFloat`
 * ЗАПРЕЩЕНЫ (C7, SRS-DOM-065): «0.1 + 0.2 !== 0.3» — катастрофа для финансов.
 *
 * Сценарии иммутабельности:
 *   - `add`/`subtract`/`multiplyByQuantity` возвращают НОВЫЙ `Money`, не мутируют.
 *   - `allocate` возвращает массив НОВЫХ `Money`.
 *
 * `Currency` — типизированная строка с известным набором (`TJS`, `USD`).
 * В R1 — фактически моно-валюта (`TJS`), но API готов к мульти-валюте
 * (R3, EP-15).
 *
 * `fromDbDecimalTjs` — для legacy `NUMERIC(10,2)` колонок (`tz.log`),
 * удаляемых в R3 после миграции всех денег на `BIGINT` дирамы.
 */
import { CurrencyMismatchError } from '@/shared-kernel/domain/errors/currency-mismatch.error.js'
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'

const DIRAMS_PER_TJS = 100n
const DECIMAL_PART_LENGTH = 2
const DECIMAL_PART_PADDING = '0'

/** ISO 4217 currency codes. В R1 — только `TJS`, в R3 добавится мульти-валюта. */
export type Currency = 'TJS' | 'USD'

export class Money {
  private constructor(
    readonly diram: bigint,
    readonly currency: Currency,
  ) {}

  /** Создание `Money` из целого числа дирамов. `n >= 0n`, иначе `InvalidMoneyError`. */
  static fromDiram(n: bigint, currency: Currency = 'TJS'): Money {
    if (n < 0n) {
      throw new InvalidMoneyError(`Money cannot be negative: ${n.toString()} dirams`, { diram: n.toString(), currency })
    }
    return new Money(n, currency)
  }

  /** Создание из decimal-строки вида `"123.45"`. Без `parseFloat`/`Number()`. */
  static fromDbDecimalTjs(raw: string, currency: Currency = 'TJS'): Money {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new InvalidMoneyError('decimal string is required', { raw })
    }
    const dotIndex = raw.indexOf('.')
    let integerPart: string
    let fractionalPart: string
    if (dotIndex === -1) {
      integerPart = raw
      fractionalPart = ''
    } else {
      integerPart = raw.slice(0, dotIndex)
      fractionalPart = raw.slice(dotIndex + 1)
    }
    if (integerPart.startsWith('-')) {
      throw new InvalidMoneyError(`Money cannot be negative: "${raw}"`, { raw })
    }
    if (fractionalPart.length > DECIMAL_PART_LENGTH) {
      throw new InvalidMoneyError(
        `fractional part has more than ${DECIMAL_PART_LENGTH} digits: "${raw}"`,
        { raw },
      )
    }
    const padded = fractionalPart.padEnd(DECIMAL_PART_LENGTH, DECIMAL_PART_PADDING)
    const diram = BigInt(integerPart) * DIRAMS_PER_TJS + BigInt(padded)
    return new Money(diram, currency)
  }

  /** Обратное форматирование в decimal-строку с 2 знаками. */
  toDbDecimalTjs(): string {
    const integer = this.diram / DIRAMS_PER_TJS
    const fraction = this.diram % DIRAMS_PER_TJS
    return `${integer.toString()}.${fraction.toString().padStart(DECIMAL_PART_LENGTH, DECIMAL_PART_PADDING)}`
  }

  add(other: Money): Money {
    assertSameCurrency(this, other, 'add')
    return new Money(this.diram + other.diram, this.currency)
  }

  subtract(other: Money): Money {
    assertSameCurrency(this, other, 'subtract')
    const result = this.diram - other.diram
    if (result < 0n) {
      throw new InvalidMoneyError(
        `subtract would yield negative Money: ${this.diram.toString()} - ${other.diram.toString()} = ${result.toString()}`,
        { minuendDiram: this.diram.toString(), subtrahendDiram: other.diram.toString() },
      )
    }
    return new Money(result, this.currency)
  }

  multiplyByQuantity(qty: number): Money {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new InvalidMoneyError(`quantity must be positive integer: ${String(qty)}`, { quantity: qty })
    }
    return new Money(this.diram * BigInt(qty), this.currency)
  }

  /**
   * Largest-remainder allocation. Возвращает массив `Money` длиной `ratios.length`,
   * такой что `Σ(result) === this.diram` (инвариант покрыт тестом).
   *
   * Тай-брейк при равных остатках — по индексу (стабильно, детерминированно).
   */
  allocate(ratios: readonly number[]): Money[] {
    if (ratios.length === 0) {
      throw new InvalidMoneyError('allocate requires non-empty ratios', { ratios: [] })
    }
    if (ratios.some((r) => r < 0 || !Number.isInteger(r) || r === 0)) {
      throw new InvalidMoneyError('allocate ratios must be positive integers', { ratios })
    }
    const sumRatios = ratios.reduce((acc, r) => acc + r, 0)
    if (sumRatios === 0) {
      throw new InvalidMoneyError('allocate ratios sum to zero', { ratios })
    }
    // Базовая доля: floor(total * ratio / sumRatios).
    const baseShares = ratios.map((r) => (this.diram * BigInt(r)) / BigInt(sumRatios))
    const allocatedSum = baseShares.reduce((acc, s) => acc + s, 0n)
    const remainder = this.diram - allocatedSum
    if (remainder < 0n) {
      throw new InvalidMoneyError('internal: allocate remainder is negative', {
        diram: this.diram.toString(),
        baseShares: baseShares.map((s) => s.toString()),
        allocatedSum: allocatedSum.toString(),
      })
    }
    // Остатки (по `ratio`) для тай-брейка. Используем модуль от умножения
    // без `Number()` — порядок сравнения — по `BigInt`, при равенстве — по индексу.
    // Сортируем индексы по убыванию fractional остатка, делим `remainder` по 1 дираму.
    const remainderPerIndex = ratios.map((r, idx) => ({
      idx,
      // `((this.diram * BigInt(r)) % BigInt(sumRatios))` — числитель fractional.
      // Чем больше числитель при том же знаменателе — тем больше нужна «добавка» дирама.
      fraction: (this.diram * BigInt(r)) % BigInt(sumRatios),
    }))
    const sortedByFraction = remainderPerIndex
      .map((entry) => ({ ...entry }))
      .sort((a, b) => {
        if (a.fraction > b.fraction) return -1
        if (a.fraction < b.fraction) return 1
        return a.idx - b.idx // детерминированный тай-брейк по индексу
      })
    const extra = new Set<number>()
    for (let i = 0; i < Number(remainder); i += 1) {
      const candidate = sortedByFraction[i]
      if (candidate === undefined) break
      extra.add(candidate.idx)
    }
    return baseShares.map((s, idx) => new Money(s + (extra.has(idx) ? 1n : 0n), this.currency))
  }

  isZero(): boolean {
    return this.diram === 0n
  }

  isPositive(): boolean {
    return this.diram > 0n
  }

  /** Всегда `false` после DTJ-007 §1 — конструктор запрещает `n < 0n`. Оставлено для API полноты. */
  isNegative(): boolean {
    return this.diram < 0n
  }

  equals(other: Money): boolean {
    assertSameCurrency(this, other, 'equals')
    return this.diram === other.diram
  }

  isGreaterThan(other: Money): boolean {
    assertSameCurrency(this, other, 'isGreaterThan')
    return this.diram > other.diram
  }

  isGreaterThanOrEqual(other: Money): boolean {
    assertSameCurrency(this, other, 'isGreaterThanOrEqual')
    return this.diram >= other.diram
  }

  isLessThan(other: Money): boolean {
    assertSameCurrency(this, other, 'isLessThan')
    return this.diram < other.diram
  }

  isLessThanOrEqual(other: Money): boolean {
    assertSameCurrency(this, other, 'isLessThanOrEqual')
    return this.diram <= other.diram
  }
}

type CurrencyOp = 'add' | 'subtract' | 'equals' | 'isGreaterThan' | 'isLessThan' | 'isLessThanOrEqual' | 'isGreaterThanOrEqual'

function assertSameCurrency(a: Money, b: Money, op: CurrencyOp): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency, op)
  }
}
