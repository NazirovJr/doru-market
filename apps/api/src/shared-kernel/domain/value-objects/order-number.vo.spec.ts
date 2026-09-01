import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { describe, expect, it } from 'vitest'
import { OrderNumberSequenceExhaustedError } from '@/shared-kernel/domain/errors/order-number-sequence-exhausted.error.js'
import { OrderNumber } from './order-number.vo.js'

describe('OrderNumber VO (DTJ-011, SRS-DOM-085/086)', () => {
  describe('fromParts', () => {
    it('1. fromParts("260827", 1) → "DTJ-260827-00001" (16 символов, ведущие нули)', () => {
      const o = OrderNumber.fromParts('260827', 1)
      expect(o.value).toBe('DTJ-260827-00001')
      expect(o.value.length).toBe(16)
    })

    it('2. fromParts("260827", 99999) → "DTJ-260827-99999" (граница)', () => {
      const o = OrderNumber.fromParts('260827', 99_999)
      expect(o.value).toBe('DTJ-260827-99999')
    })

    it('3. fromParts("260827", 100000) → throws OrderNumberSequenceExhaustedError', () => {
      expect((): OrderNumber => OrderNumber.fromParts('260827', 100_000)).toThrow(
        OrderNumberSequenceExhaustedError,
      )
    })

    it('4. fromParts("260827", 0) → throws (seq5 < 1)', () => {
      expect((): OrderNumber => OrderNumber.fromParts('260827', 0)).toThrow(
        OrderNumberSequenceExhaustedError,
      )
    })

    it('5. fromParts("260827", 1.5) → throws (не целое)', () => {
      expect((): OrderNumber => OrderNumber.fromParts('260827', 1.5)).toThrow(
        OrderNumberSequenceExhaustedError,
      )
    })
  })

  describe('parse', () => {
    it('6. parse валидного "DTJ-260827-00001" → ok', () => {
      const r = OrderNumber.parse('DTJ-260827-00001')
      expect(isOk(r)).toBe(true)
      if (!isOk(r)) return
      expect(r.value.value).toBe('DTJ-260827-00001')
    })

    it('7. parse невалидной строки → err(VALIDATION_ERROR)', () => {
      const r = OrderNumber.parse('not-an-order-number')
      expect(isErr(r)).toBe(true)
      if (!isErr(r)) return
      expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('8. parse с маленькой буквой "dtj-260827-00001" → err', () => {
      const r = OrderNumber.parse('dtj-260827-00001')
      expect(isErr(r)).toBe(true)
    })

    it('9. parse с буквенной контрольной цифрой "DTJ-260827-ABCDE" → err', () => {
      const r = OrderNumber.parse('DTJ-260827-ABCDE')
      expect(isErr(r)).toBe(true)
    })
  })
})
