import { describe, expect, it } from 'vitest'
import { PaymentProviderError } from './payment-provider.error.js'
import { NotSupportedByProviderError } from './not-supported-by-provider.error.js'

describe('PaymentProviderError', () => {
  it('несёт code/message/details и корректное name (DTJ-237)', () => {
    const error = new PaymentProviderError('PROVIDER_TIMEOUT', 'timed out', { providerRef: 'x' })

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('PROVIDER_TIMEOUT')
    expect(error.message).toBe('timed out')
    expect(error.details).toEqual({ providerRef: 'x' })
    expect(error.name).toBe('PaymentProviderError')
  })

  it('details опционален', () => {
    const error = new PaymentProviderError('X', 'y')
    expect(error.details).toBeUndefined()
  })
})

describe('NotSupportedByProviderError', () => {
  it('является PaymentProviderError с фиксированным кодом (SRS-PAY-001)', () => {
    const error = new NotSupportedByProviderError('partialRefund', 'mock_bank')

    expect(error).toBeInstanceOf(PaymentProviderError)
    expect(error.code).toBe('NOT_SUPPORTED_BY_PROVIDER')
    expect(error.name).toBe('NotSupportedByProviderError')
    expect(error.details).toEqual({ operation: 'partialRefund', providerName: 'mock_bank' })
    expect(error.message).toContain('partialRefund')
    expect(error.message).toContain('mock_bank')
  })
})
