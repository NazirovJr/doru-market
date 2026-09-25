// DTJ-364: НЕ дублирует POST /api/v1/staff-accounts (DTJ-030) — только policy сети перед вызовом
// DeliveryFacade.provisionCourier (идемпотентность — на стороне facade).
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CrossChainAccessDeniedError } from '../errors/cross-chain-access-denied.error.js'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort } from '../ports/identity-facade.port.js'
import {
  DELIVERY_FACADE_PORT,
  type CourierSummaryView,
  type DeliveryFacadePort,
} from '../ports/delivery-facade.port.js'

export interface ProvisionCourierForChainCommand {
  readonly userId: string
  readonly actor: { readonly role: string; readonly chainId: string | null }
}

@Injectable()
export class ProvisionCourierForChainUseCase {
  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(DELIVERY_FACADE_PORT) private readonly deliveryFacade: DeliveryFacadePort,
  ) {}

  public async execute(command: ProvisionCourierForChainCommand): Promise<CourierSummaryView> {
    const target = await this.identityFacade.getUser?.(command.userId)
    if (target === undefined || target === null) {
      throw new NotFoundError({ resource: 'user', userId: command.userId })
    }
    if (target.role !== 'courier') {
      throw new ForbiddenError(`role="${target.role}" is not a courier — provisioning not applicable`, {
        targetRole: target.role,
      })
    }
    const targetChainId = target.chainId ?? null
    if (command.actor.role !== 'super_admin' && targetChainId !== command.actor.chainId) {
      throw new CrossChainAccessDeniedError('Courier belongs to a different chain', {
        actorChainId: command.actor.chainId,
        targetChainId,
      })
    }
    if (targetChainId === null) {
      // Платформенный пул (chainId=null) — вне периметра pharmacy_admin.
      throw new ForbiddenError('Cannot provision a platform-pool courier via chain staff-accounts', { userId: command.userId })
    }

    return this.deliveryFacade.provisionCourier({ userId: command.userId, chainId: targetChainId })
  }
}
