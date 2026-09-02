import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from './permissions.js'

describe('PERMISSIONS', () => {
  it('нет дублирующихся строковых значений', () => {
    const values = Object.values(PERMISSIONS)
    expect(new Set(values).size).toBe(values.length)
  })

  it('содержит все 34 permission-строки матрицы §4.1', () => {
    expect(Object.values(PERMISSIONS)).toHaveLength(34)
  })

  it('каждая строка соответствует формату <resource>:<action>[:<scope>] (SRS-API-038)', () => {
    const pattern = /^[a-z0-9-]+:[a-z0-9-]+(:[a-z0-9-]+)?$/
    for (const value of Object.values(PERMISSIONS)) {
      expect(value).toMatch(pattern)
    }
  })
})
