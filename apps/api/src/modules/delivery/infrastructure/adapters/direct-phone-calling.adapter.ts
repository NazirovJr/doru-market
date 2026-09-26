import { Inject, Injectable } from '@nestjs/common'
import { USERS_REPOSITORY, type UsersRepository } from '@/modules/auth/index.js'
import {
  MASKED_CALLING_PORT,
  type CustomerContact,
  type MaskedCallingPort,
} from '@/modules/delivery/application/ports/masked-calling.port.js'

// MVP (SRS-DELIV-044) — прямой номер, isMasked всегда false. Маскирующий шлюз — вне R1.
@Injectable()
export class DirectPhoneCallingAdapter implements MaskedCallingPort {
  public constructor(@Inject(USERS_REPOSITORY) private readonly users: UsersRepository) {}

  public async getCustomerContact(customerId: string): Promise<CustomerContact> {
    const user = await this.users.findById(customerId)
    return { phoneNumber: user?.phoneNumber ?? null, isMasked: false }
  }
}

export const MASKED_CALLING_PORT_PROVIDER = {
  provide: MASKED_CALLING_PORT,
  useClass: DirectPhoneCallingAdapter,
} as const
