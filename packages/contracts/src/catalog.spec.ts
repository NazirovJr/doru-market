import { describe, expect, it } from 'vitest'
import { CONTROL_CATEGORY_VALUES_PUBLIC, SEARCH_DEFAULT_RADIUS_METERS } from './catalog.js'

describe('CONTROL_CATEGORY_VALUES_PUBLIC', () => {
  it('содержит ровно допустимые категории контроля в фиксированном порядке', () => {
    expect(CONTROL_CATEGORY_VALUES_PUBLIC).toEqual([
      'none',
      'prescription_only',
      'potent',
      'psychotropic',
      'narcotic',
    ])
  })

  it('none — минимальная (нерецептурная) категория, присутствует в наборе', () => {
    expect(CONTROL_CATEGORY_VALUES_PUBLIC).toContain('none')
  })

  it('narcotic — максимальная категория контроля, присутствует в наборе', () => {
    expect(CONTROL_CATEGORY_VALUES_PUBLIC).toContain('narcotic')
  })
})

describe('SEARCH_DEFAULT_RADIUS_METERS', () => {
  it('равен 5000 м (SRS-CAT-011)', () => {
    expect(SEARCH_DEFAULT_RADIUS_METERS).toBe(5000)
  })
})
