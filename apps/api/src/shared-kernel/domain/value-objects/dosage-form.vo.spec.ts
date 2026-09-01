import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { describe, expect, it } from 'vitest'
import { DosageForm } from './dosage-form.vo.js'

describe('DosageForm VO (DTJ-009, SRS-DOM-079)', () => {
  it('1. "таблетка" → ok("tablet")', () => {
    const r = DosageForm.parse('таблетка')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('tablet')
  })

  it('2. "сироп" → ok("syrup")', () => {
    const r = DosageForm.parse('сироп')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('syrup')
  })

  it('3. "капсула" → ok("capsule")', () => {
    const r = DosageForm.parse('капсула')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('capsule')
  })

  it('4. "мазь" → ok("ointment")', () => {
    const r = DosageForm.parse('мазь')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('ointment')
  })

  it('5. "tablet" (англ) → ok("tablet")', () => {
    const r = DosageForm.parse('tablet')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('tablet')
  })

  it('6. isEquivalentTo: таблетка == таблетка → true', () => {
    const a = DosageForm.parse('таблетка')
    const b = DosageForm.parse('таб')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(true)
  })

  it('7. isEquivalentTo: таблетка != капсула → false (строгое сравнение)', () => {
    const a = DosageForm.parse('таблетка')
    const b = DosageForm.parse('капсула')
    expect(isOk(a)).toBe(true)
    expect(isOk(b)).toBe(true)
    if (!isOk(a) || !isOk(b)) return
    expect(a.value.isEquivalentTo(b.value)).toBe(false)
  })

  it('8. неизвестная форма → ok("other"), НЕ err', () => {
    const r = DosageForm.parse('леденцы')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.form).toBe('other')
  })

  it('9. пустая строка → err(VALIDATION_ERROR)', () => {
    const r = DosageForm.parse('')
    expect(isErr(r)).toBe(true)
    if (!isErr(r)) return
    expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })
})
