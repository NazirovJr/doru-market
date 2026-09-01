import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { describe, expect, it } from 'vitest'
import { Dosage, type DosageUnit } from './dosage.vo.js'

describe('Dosage VO (DTJ-009, SRS-DOM-077/078)', () => {
  it('1. "500 мг" → ok(500n, "mg")', () => {
    const r = Dosage.parse('500 мг')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.value).toBe(500n)
    expect(r.value.unit).toBe('mg')
  })

  it('2. "10 мг/мл" → ok(10n, "mg_per_ml")', () => {
    const r = Dosage.parse('10 мг/мл')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.unit).toBe('mg_per_ml')
  })

  it('3. невалидный формат → ValidationError', () => {
    const r = Dosage.parse('abc')
    expect(isErr(r)).toBe(true)
    if (!isErr(r)) return
    expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })

  it('4. isEquivalentTo: 1 g ≡ 1000 mg (mass family)', () => {
    const a = Dosage.parse('1 g')
    const b = Dosage.parse('1000 mg')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(true)
    expect(b.value.isEquivalentTo(a.value)).toBe(true)
  })

  it('5. isEquivalentTo: 1 g ≡ 1_000_000 mcg', () => {
    const a = Dosage.parse('1 g')
    const b = Dosage.parse('1000000 mcg')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(true)
  })

  it('6. isEquivalentTo: 500 mg ≠ 500 ml (mass vs volume)', () => {
    const a = Dosage.parse('500 mg')
    const b = Dosage.parse('500 ml')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(false)
  })

  it('7. isEquivalentTo: 100 mg ≠ 1000 mg (строгое сравнение, без допуска)', () => {
    const a = Dosage.parse('100 mg')
    const b = Dosage.parse('1000 mg')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(false)
  })

  it('8. isEquivalentTo: 10 iu vs 10 iu → true (activity family)', () => {
    const a = Dosage.parse('10 iu')
    const b = Dosage.parse('10 iu')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(true)
  })

  describe('normalizeUnit — все варианты алиасов (полное покрытие)', () => {
    const cases: readonly (readonly [string, DosageUnit])[] = [
      ['мг', 'mg'],
      ['mg', 'mg'],
      ['мкг', 'mcg'],
      ['mcg', 'mcg'],
      ['µg', 'mcg'],
      ['г', 'g'],
      ['g', 'g'],
      ['мл', 'ml'],
      ['ml', 'ml'],
      ['ме', 'iu'],
      ['iu', 'iu'],
      ['%', 'percent'],
      ['percent', 'percent'],
      // Без префикса `10 ` (в отличие от прежней версии): `it.each` ниже
      // сам подставляет число через `` `1 ${raw}` ``, каждый элемент здесь —
      // ТОЛЬКО алиас единицы. С префиксом получалось `"1 10 мг/мл"` —
      // строка с ДВУМЯ числовыми токенами, не проходящая regex парсера
      // (`Dosage.parse` ожидает РОВНО `<число><пробелы><единица>`).
      ['мг/мл', 'mg_per_ml'],
      ['mg/ml', 'mg_per_ml'],
      ['мг\\мл', 'mg_per_ml'],
      ['mg\\ml', 'mg_per_ml'],
    ]
    it.each(cases)('"%s" → %s', (raw, expectedUnit) => {
      const r = Dosage.parse(`1 ${raw}`)
      expect(isOk(r)).toBe(true)
      if (!isOk(r)) return
      expect(r.value.unit).toBe(expectedUnit)
    })

    it('неизвестная единица → ValidationError', () => {
      const r = Dosage.parse('5 xyz')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('дробное значение отклоняется (bigint не принимает дробные)', () => {
      const r = Dosage.parse('1.5 мг')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('пустой ввод → ValidationError', () => {
      const r = Dosage.parse('')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('только пробелы → ValidationError', () => {
      const r = Dosage.parse('   ')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('значение без единицы → ValidationError', () => {
      const r = Dosage.parse('500')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('единица без значения → ValidationError', () => {
      const r = Dosage.parse('мг')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('0 mg валиден (нулевая дозировка)', () => {
      const r = Dosage.parse('0 mg')
      expect(isOk(r)).toBe(true)
      if (!isOk(r)) return
      expect(r.value.value).toBe(0n)
    })
  })

  describe('isEquivalentTo — расширенные кейсы покрытия', () => {
    it('9. 1000 mg ≡ 1 g (прямое сравнение внутри mass)', () => {
      const a = Dosage.parse('1000 mg')
      const b = Dosage.parse('1 g')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('10. 1_000_000 mcg ≡ 1000 mg (обратное сравнение)', () => {
      const a = Dosage.parse('1000000 mcg')
      const b = Dosage.parse('1000 mg')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('11. 500 mg ≡ 500_000 mcg', () => {
      const a = Dosage.parse('500 mg')
      const b = Dosage.parse('500000 mcg')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('12. 0 mg ≡ 0 mcg (нулевые значения всегда равны)', () => {
      const a = Dosage.parse('0 mg')
      const b = Dosage.parse('0 mcg')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('13. 10 percent ≠ 10 ml (разные семейства: percent vs volume)', () => {
      const a = Dosage.parse('10 percent')
      const b = Dosage.parse('10 ml')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    })

    it('14. 10 mg_per_ml ≠ 10 mg (разные семейства: concentration vs mass)', () => {
      // `'mg_per_ml'` — внутреннее имя `DosageUnit`, а не пользовательский
      // алиас: `normalizeUnit` его не распознаёт (см. таблицу алиасов —
      // `мг/мл`/`mg/ml`/`мг\мл`/`mg\ml`). Используем реальный алиас `mg/ml`.
      const a = Dosage.parse('10 mg/ml')
      const b = Dosage.parse('10 mg')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    })

    it('15. 10 iu ≠ 10 mg (activity vs mass)', () => {
      const a = Dosage.parse('10 iu')
      const b = Dosage.parse('10 mg')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    })

    it('16. 10 ml ≠ 10 ml_percent (volume vs percent)', () => {
      const a = Dosage.parse('10 ml')
      const b = Dosage.parse('10 percent')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    })

    it('17. 10 ml ≡ 10 ml (одна и та же единица объёма)', () => {
      const a = Dosage.parse('10 ml')
      const b = Dosage.parse('10 ml')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('18. 10 mg_per_ml ≡ 10 mg_per_ml (одна и та же концентрация)', () => {
      // См. комментарий в тесте 14 — реальный алиас, не внутреннее имя unit'а.
      const a = Dosage.parse('10 mg/ml')
      const b = Dosage.parse('10 mg/ml')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('19. 10 percent ≡ 10 percent (одна и та же процентная единица)', () => {
      const a = Dosage.parse('10 percent')
      const b = Dosage.parse('10 percent')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(true)
    })

    it('20. 10 iu ≠ 100 iu (разные значения активности)', () => {
      const a = Dosage.parse('10 iu')
      const b = Dosage.parse('100 iu')
      expect(isOk(a)).toBe(true)
      expect(isOk(b)).toBe(true)
      if (!isOk(a) || !isOk(b)) return
      expect(a.value.isEquivalentTo(b.value)).toBe(false)
    })
  })
})
