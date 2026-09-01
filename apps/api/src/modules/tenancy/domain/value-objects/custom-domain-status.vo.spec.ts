import { describe, it, expect } from 'vitest'
import { CustomDomainStatusVO } from './custom-domain-status.vo.js'

describe('CustomDomainStatusVO', () => {
  it('exposes none/pending/verified factories', () => {
    expect(CustomDomainStatusVO.none().value).toBe('none')
    expect(CustomDomainStatusVO.pending().value).toBe('pending_verification')
    expect(CustomDomainStatusVO.verified().value).toBe('verified')
  })

  it('parses all valid values', () => {
    expect(CustomDomainStatusVO.parse('none').value).toBe('none')
    expect(CustomDomainStatusVO.parse('pending_verification').value).toBe('pending_verification')
    expect(CustomDomainStatusVO.parse('verified').value).toBe('verified')
  })

  it('rejects unknown status', () => {
    expect(() => CustomDomainStatusVO.parse('not-a-status')).toThrow(/Invalid custom domain status/)
  })

  it('isResolvedByDomain() returns true only for verified', () => {
    expect(CustomDomainStatusVO.none().isResolvedByDomain()).toBe(false)
    expect(CustomDomainStatusVO.pending().isResolvedByDomain()).toBe(false)
    expect(CustomDomainStatusVO.verified().isResolvedByDomain()).toBe(true)
  })
})
