import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from './permissions.js'

describe('PERMISSIONS', () => {
  it('нет дублирующихся строковых значений', () => {
    const values = Object.values(PERMISSIONS)
    expect(new Set(values).size).toBe(values.length)
  })

  // 34 строки исходной матрицы §4.1 + 1 `returns:mark-in-transit` (DTJ-275) + 5 `support:*`
  // (DTJ-282, SRS-API-038) — раздел `support:*` не входил в исходную матрицу вовсе (только
  // `disputes:*`/`returns:*`), новые строки одной группой в конец каталога (D-27).
  it('содержит все 34 permission-строки матрицы §4.1 + 1 returns:mark-in-transit (DTJ-275) + 5 support:* (DTJ-282) = 40', () => {
    expect(Object.values(PERMISSIONS)).toHaveLength(40)
  })

  it('каждая строка соответствует формату <resource>:<action>[:<scope>] (SRS-API-038)', () => {
    const pattern = /^[a-z0-9-]+:[a-z0-9-]+(:[a-z0-9-]+)?$/
    for (const value of Object.values(PERMISSIONS)) {
      expect(value).toMatch(pattern)
    }
  })
})
