/**
 * Unit-тест `maskIpAddress` (EP-01, DTJ-026, SRS-API-149).
 *
 * Чистая функция: маскирует последний октет IPv4 / последний блок IPv6.
 * Покрывает все 4 типа входа: IPv4, IPv6, пустая строка, неизвестный формат.
 */
import { describe, expect, it } from 'vitest'
import { maskIpAddress } from './mask-ip-address.js'

describe('maskIpAddress (DTJ-026, SRS-API-149)', () => {
  it('1. IPv4: маскирует последний октет', () => {
    expect(maskIpAddress('192.168.1.42')).toBe('192.168.1.*')
  })
  it('2. IPv4: минимальный формат /8', () => {
    expect(maskIpAddress('10.0.0.1')).toBe('10.0.0.*')
  })
  it('3. IPv4: корректно работает с одним октетом (fallback)', () => {
    // Невалидный IPv4 (только один октет) — fallback на `${ip}.*`.
    expect(maskIpAddress('192')).toBe('192.*')
  })
  it('4. IPv6: маскирует последний блок', () => {
    expect(maskIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
      '2001:0db8:85a3:0000:0000:8a2e:0370:*',
    )
  })
  it('5. IPv6: minimal', () => {
    expect(maskIpAddress('::1')).toBe('::*')
  })
  it('6. пустая строка → "*"', () => {
    expect(maskIpAddress('')).toBe('*')
  })
  it('7. неизвестный формат → добавляет * в конец', () => {
    // Безопасный fallback: НЕ возвращаем сырой IP, маскируем хотя бы одним символом.
    expect(maskIpAddress('garbage')).toBe('garbage*')
  })
})
