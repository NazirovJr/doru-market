/**
 * `@CartIdentity()` (EP-09, DTJ-226) — параметр-декоратор, достаёт `CartIdentity`
 * (`customerId` | `sessionToken`), которую `CartIdentityGuard` кладёт в
 * `request.cartIdentity`. Тот же приём, что `@CurrentUser()` (`modules/auth/presentation/
 * decorators/current-user.decorator.ts`).
 */
import { type ExecutionContext, createParamDecorator } from '@nestjs/common'
import type { CartIdentity as CartIdentityInput } from '@/modules/orders/application/cart/resolve-or-create-cart.use-case.js'

export const CartIdentity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CartIdentityInput => {
    const request = ctx.switchToHttp().getRequest<{ cartIdentity?: CartIdentityInput }>()
    if (request.cartIdentity === undefined) {
      throw new Error('@CartIdentity() used on a route without @UseGuards(CartIdentityGuard) — identity not set')
    }
    return request.cartIdentity
  },
)
