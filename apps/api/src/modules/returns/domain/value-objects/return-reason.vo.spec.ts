import { describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { RETURN_REASON_VALUES } from '@dorutj/contracts'
import { ReturnReason } from './return-reason.vo.js'

describe('ReturnReason', () => {
  it.each(RETURN_REASON_VALUES)('parse() принимает валидное значение "%s"', (value) => {
    const result = ReturnReason.parse(value)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.value).toBe(value)
    }
  })

  it('parse() отклоняет невалидную строку без исключения (Result, не throw)', () => {
    const result = ReturnReason.parse('not_a_real_reason')
    expect(isErr(result)).toBe(true)
    expect(() => ReturnReason.parse('not_a_real_reason')).not.toThrow()
  })

  it('fromTrusted() конструирует напрямую из доверенного значения', () => {
    const reason = ReturnReason.fromTrusted('defect')
    expect(reason.value).toBe('defect')
  })

  it('equals() сравнивает по значению', () => {
    const a = ReturnReason.fromTrusted('defect')
    const b = ReturnReason.fromTrusted('defect')
    const c = ReturnReason.fromTrusted('wrong_item')
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it('toString() возвращает сырое значение', () => {
    expect(ReturnReason.fromTrusted('undeliverable').toString()).toBe('undeliverable')
  })
})
