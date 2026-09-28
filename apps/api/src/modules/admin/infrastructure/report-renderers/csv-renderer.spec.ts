import { describe, expect, it } from 'vitest'
import { renderCsv } from './csv-renderer.js'

describe('renderCsv', () => {
  it('возвращает Buffer с UTF-8 BOM и корректными данными', () => {
    const buffer = renderCsv([{ name: 'Панадол' }], [{ key: 'name', header: 'Название' }])
    const text = buffer.toString('utf-8')
    expect(text).toBe('﻿Название\r\nПанадол')
  })

  it('экранирует запятую в значении', () => {
    const buffer = renderCsv([{ a: 'x,y' }], [{ key: 'a', header: 'A' }])
    expect(buffer.toString('utf-8')).toBe('﻿A\r\n"x,y"')
  })
})
