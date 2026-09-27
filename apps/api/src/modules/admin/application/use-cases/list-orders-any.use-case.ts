// Application-policy (не guard) — не-super_admin отказывается ДО обращения к порту, тот же приём, что ListPharmacyAccountsAnyUseCase.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import {
  ORDERS_FACADE_PORT,
  type OrdersAnyFilter,
  type OrdersAnyPage,
  type OrdersCursor,
  type OrdersFacadePort,
} from '../ports/orders-facade.port.js'

export interface ListOrdersAnyActor {
  readonly role: UserRole
}

export interface ListOrdersAnyCommand {
  readonly actor: ListOrdersAnyActor
  readonly filter: OrdersAnyFilter
  readonly limit: number
  readonly cursor?: OrdersCursor | null
}

@Injectable()
export class ListOrdersAnyUseCase {
  public constructor(@Inject(ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort) {}

  public async execute(command: ListOrdersAnyCommand): Promise<OrdersAnyPage> {
    if (command.actor.role !== 'super_admin') {
      throw new CrossTenantAccessDeniedError({ role: command.actor.role })
    }
    return this.ordersFacade.findOrdersAny(command.filter, { limit: command.limit, cursor: command.cursor ?? null })
  }
}
