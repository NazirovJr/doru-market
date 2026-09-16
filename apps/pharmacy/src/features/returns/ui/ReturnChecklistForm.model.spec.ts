import { describe, expect, it } from 'vitest'
import {
  buildConfirmChecklistPayload,
  INITIAL_CHECKLIST_STATE,
  isRejectReasonValid,
  resolvePackagingToggleState,
} from './ReturnChecklistForm.model'

/**
 * DTJ-277 тест-план: «блокировка packagingIntact по controlCategory, валидация обязательной
 * причины отказа». Критерии приёмки 1-3.
 */
describe('resolvePackagingToggleState (DTJ-277 критерий приёмки 1/2)', () => {
  it('controlCategory=none → не заблокирован, значение = запрошенное', () => {
    expect(resolvePackagingToggleState('none', true)).toEqual({ locked: false, value: true })
    expect(resolvePackagingToggleState('none', false)).toEqual({ locked: false, value: false })
  })

  it('controlCategory=psychotropic → заблокирован в положении "restock невозможен" (false)', () => {
    expect(resolvePackagingToggleState('psychotropic', true)).toEqual({ locked: true, value: false })
  })

  it('controlCategory=narcotic/potent/prescription_only → тоже заблокирован', () => {
    expect(resolvePackagingToggleState('narcotic', true).locked).toBe(true)
    expect(resolvePackagingToggleState('potent', true).locked).toBe(true)
    expect(resolvePackagingToggleState('prescription_only', true).locked).toBe(true)
  })

  it('controlCategory=undefined (поле отсутствует у бэкенда) → консервативно НЕ блокирует', () => {
    expect(resolvePackagingToggleState(undefined, true)).toEqual({ locked: false, value: true })
  })
})

describe('buildConfirmChecklistPayload', () => {
  it('заблокированный переключатель → отправляется packagingIntact=false, независимо от локального состояния', () => {
    const payload = buildConfirmChecklistPayload('psychotropic', { packagingIntact: true, notes: '' })
    expect(payload).toEqual({ packagingIntact: false })
  })

  it('незаблокированный переключатель → отправляется как есть', () => {
    const payload = buildConfirmChecklistPayload('none', { packagingIntact: true, notes: '' })
    expect(payload).toEqual({ packagingIntact: true })
  })

  it('notes обрезаются и опускаются из payload, если пусты', () => {
    expect(buildConfirmChecklistPayload('none', { packagingIntact: true, notes: '   ' })).toEqual({
      packagingIntact: true,
    })
  })

  it('непустые notes включаются в payload обрезанными', () => {
    expect(buildConfirmChecklistPayload('none', { packagingIntact: false, notes: '  порвана коробка  ' })).toEqual({
      packagingIntact: false,
      notes: 'порвана коробка',
    })
  })

  it('INITIAL_CHECKLIST_STATE — packagingIntact=true, notes пусты', () => {
    expect(INITIAL_CHECKLIST_STATE).toEqual({ packagingIntact: true, notes: '' })
  })
})

describe('isRejectReasonValid (DTJ-277 критерий приёмки 3)', () => {
  it('пустая строка — невалидна', () => {
    expect(isRejectReasonValid('')).toBe(false)
  })

  it('строка из одних пробелов — невалидна', () => {
    expect(isRejectReasonValid('   ')).toBe(false)
  })

  it('непустая причина — валидна', () => {
    expect(isRejectReasonValid('Клиент передумал')).toBe(true)
  })
})
