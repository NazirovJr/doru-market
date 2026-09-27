import { describe, expect, it } from 'vitest'
import { isOtpExpired } from './handover.model'

describe('handover.model — isOtpExpired', () => {
  it('now < expiresAt — не истёк', () => {
    expect(isOtpExpired(new Date(Date.now() + 60_000).toISOString(), Date.now())).toBe(false)
  })

  it('now > expiresAt — истёк', () => {
    expect(isOtpExpired(new Date(Date.now() - 1_000).toISOString(), Date.now())).toBe(true)
  })
})
