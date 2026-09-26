// MVP: DirectPhoneCallingAdapter возвращает прямой номер (isMasked: false); реальный маскирующий
// шлюз подключается позже отдельным адаптером без изменений вызывающего кода.
export const MASKED_CALLING_PORT = Symbol.for('@dorutj/delivery/masked-calling-port')

export interface CustomerContact {
  readonly phoneNumber: string | null
  readonly isMasked: boolean
}

export interface MaskedCallingPort {
  getCustomerContact(customerId: string): Promise<CustomerContact>
}
