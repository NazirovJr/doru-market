/** Таблица кейсов: верхний уровень, глубокая вложенность, массив, иммутабельность входа. */
import { describe, expect, it } from 'vitest'
import { SENSITIVE_FIELD_NAMES, maskSensitiveFields } from './sensitive-fields.js'

const REDACTED = '[REDACTED]'

describe('SENSITIVE_FIELD_NAMES', () => {
  it('содержит минимальный набор DTJ-374 и токены сессии DTJ-022/024/025', () => {
    expect(SENSITIVE_FIELD_NAMES).toEqual(
      expect.arrayContaining(['apiKey', 'hmacSecret', 'codeHash', 'password', 'refreshToken', 'accessToken']),
    )
  })
})

describe('maskSensitiveFields (DTJ-375, AC1)', () => {
  it('маскирует поле верхнего уровня', () => {
    expect(maskSensitiveFields({ password: 'hunter2', role: 'customer' })).toEqual({
      password: REDACTED,
      role: 'customer',
    })
  })

  it('AC1 — маскирует поле на ВТОРОЙ глубине вложенности (буквальный кейс тикета)', () => {
    expect(maskSensitiveFields({ user: { apiKey: 'sec_live_123' } })).toEqual({
      user: { apiKey: REDACTED },
    })
  })

  it('маскирует поле, вложенное глубже второго уровня', () => {
    expect(maskSensitiveFields({ a: { b: { c: { hmacSecret: 'x' } } } })).toEqual({
      a: { b: { c: { hmacSecret: REDACTED } } },
    })
  })

  it('маскирует поле внутри массива объектов', () => {
    expect(maskSensitiveFields({ items: [{ accessToken: 'x', ok: true }, { refreshToken: 'y' }] })).toEqual({
      items: [{ accessToken: REDACTED, ok: true }, { refreshToken: REDACTED }],
    })
  })

  it('маскирует поле внутри массива, вложенного глубже верхнего уровня', () => {
    expect(maskSensitiveFields({ audit: { entries: [{ codeHash: 'x' }] } })).toEqual({
      audit: { entries: [{ codeHash: REDACTED }] },
    })
  })

  it('несколько чувствительных полей одновременно — каждое маскировано независимо', () => {
    expect(maskSensitiveFields({ apiKey: 'a', hmacSecret: 'b', ok: 1 })).toEqual({
      apiKey: REDACTED,
      hmacSecret: REDACTED,
      ok: 1,
    })
  })

  it('нет чувствительных полей — форма и значения сохранены, вход не мутирован', () => {
    const input = { role: 'customer', count: 3, list: [1, 2, 3], nested: { ok: true } }
    const inputSnapshot = structuredClone(input)

    const result = maskSensitiveFields(input)

    expect(result).toEqual(input)
    expect(input).toEqual(inputSnapshot)
  })

  it('не мутирует вход, когда поле замаскировано', () => {
    const input = { password: 'hunter2' }

    const result = maskSensitiveFields(input)

    expect(input.password).toBe('hunter2')
    expect(result.password).toBe(REDACTED)
  })

  it('пустой объект → пустой объект', () => {
    expect(maskSensitiveFields({})).toEqual({})
  })

  it('null-значение поля сохраняется как есть (не превращается в маркер)', () => {
    expect(maskSensitiveFields({ nested: null })).toEqual({ nested: null })
  })
})
