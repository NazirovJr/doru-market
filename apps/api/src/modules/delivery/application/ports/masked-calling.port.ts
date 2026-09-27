// MVP: DirectPhoneCallingAdapter возвращает прямой номер; маскирующий шлюз — отдельный адаптер позже.
export const MASKED_CALLING_PORT = Symbol.for('@dorutj/delivery/masked-calling-port')

export interface CustomerContact {
  readonly phoneNumber: string | null
  readonly isMasked: boolean
}

export interface MaskedCallingPort {
  getCustomerContact(customerId: string): Promise<CustomerContact>
}
