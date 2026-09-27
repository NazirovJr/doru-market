import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, type UserRole } from '@dorutj/contracts'
import {
  ORDERS_FACADE_PORT,
  type OrdersAnyFilter,
  type OrdersAnyPage,
  type OrdersCursor,
  type OrdersFacadePort,
} from '../ports/orders-facade.port.js'

export interface ListOrdersOwnActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export type OrdersOwnFilter = Omit<OrdersAnyFilter, 'tenantId' | 'pharmacyId' | 'chainId'>

export interface ListOrdersOwnCommand {
  readonly actor: ListOrdersOwnActor
  readonly filter: OrdersOwnFilter
  readonly limit: number
  readonly cursor?: OrdersCursor | null
}

const EMPTY_PAGE: OrdersAnyPage = { items: [], nextCursor: null, hasMore: false }

@Injectable()
export class ListOrdersOwnUseCase {
  public constructor(@Inject(ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort) {}

  public async execute(command: ListOrdersOwnCommand): Promise<OrdersAnyPage> {
    // super_admin + scope=own семантически бессмыслен (нет chainId) — пустой список, не ошибка.
    if (command.actor.role === 'super_admin') {
      return EMPTY_PAGE
    }
    if (command.actor.role !== 'pharmacy_admin' || command.actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: command.actor.role })
    }
    const filter: OrdersAnyFilter = { ...command.filter, chainId: command.actor.chainId }
    return this.ordersFacade.findOrdersAny(filter, { limit: command.limit, cursor: command.cursor ?? null })
  }
}
