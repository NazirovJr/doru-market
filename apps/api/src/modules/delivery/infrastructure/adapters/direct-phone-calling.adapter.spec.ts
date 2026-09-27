import { describe, expect, it, vi } from 'vitest'
import type { UsersRepository } from '@/modules/auth/index.js'
import { DirectPhoneCallingAdapter } from './direct-phone-calling.adapter.js'

describe('DirectPhoneCallingAdapter', () => {
  it('MVP (SRS-DELIV-044) — возвращает прямой номер, isMasked всегда false', async () => {
    const users = { findById: vi.fn().mockResolvedValue({ phoneNumber: '+992900000000' }) } as unknown as UsersRepository
    const adapter = new DirectPhoneCallingAdapter(users)

    const contact = await adapter.getCustomerContact('customer-1')

    expect(contact).toEqual({ phoneNumber: '+992900000000', isMasked: false })
  })

  it('пользователь не найден / телефон не задан -> phoneNumber: null', async () => {
    const users = { findById: vi.fn().mockResolvedValue(null) } as unknown as UsersRepository
    const adapter = new DirectPhoneCallingAdapter(users)

    const contact = await adapter.getCustomerContact('customer-unknown')

    expect(contact).toEqual({ phoneNumber: null, isMasked: false })
  })
})
