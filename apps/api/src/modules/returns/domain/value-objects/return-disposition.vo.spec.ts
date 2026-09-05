import { describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { RETURN_DISPOSITION_VALUES } from '@dorutj/contracts'
import { ReturnDisposition } from './return-disposition.vo.js'

describe('ReturnDisposition', () => {
  it.each(RETURN_DISPOSITION_VALUES)('parse() принимает валидное значение "%s"', (value) => {
    const result = ReturnDisposition.parse(value)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.value).toBe(value)
    }
  })

  it('parse() отклоняет невалидную строку без исключения (Result, не throw)', () => {
    const result = ReturnDisposition.parse('scrap_it')
    expect(isErr(result)).toBe(true)
  })

  it('restock()/destroy()/pendingInspection() — именованные фабрики', () => {
    expect(ReturnDisposition.restock().value).toBe('restock')
    expect(ReturnDisposition.destroy().value).toBe('destroy')
    expect(ReturnDisposition.pendingInspection().value).toBe('pending_inspection')
  })

  it('equals() сравнивает по значению', () => {
    expect(ReturnDisposition.restock().equals(ReturnDisposition.restock())).toBe(true)
    expect(ReturnDisposition.restock().equals(ReturnDisposition.destroy())).toBe(false)
  })
})
