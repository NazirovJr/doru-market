import { describe, it, expect } from 'vitest'
import { CourierSourcingModeVO, COURIER_SOURCING_MODES } from './courier-sourcing-mode.vo.js'

describe('CourierSourcingModeVO', () => {
  it('accepts all three valid modes', () => {
    for (const mode of COURIER_SOURCING_MODES) {
      expect(CourierSourcingModeVO.parse(mode).value).toBe(mode)
    }
  })

  it('rejects an unknown mode', () => {
    expect(() => CourierSourcingModeVO.parse('not_a_mode')).toThrow(/Invalid courier sourcing mode/)
  })

  it('exposes a platformPool factory', () => {
    expect(CourierSourcingModeVO.platformPool().value).toBe('platform_pool')
  })

  it('compares by value', () => {
    expect(CourierSourcingModeVO.parse('own_fleet').equals(CourierSourcingModeVO.parse('own_fleet'))).toBe(true)
    expect(CourierSourcingModeVO.parse('own_fleet').equals(CourierSourcingModeVO.parse('hybrid'))).toBe(false)
  })
})
