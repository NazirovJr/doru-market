// Тот же приём, что @CartIdentity() — читает request.analyticsUserId, заполненный guard'ом.
import { type ExecutionContext, createParamDecorator } from '@nestjs/common'

export const AnalyticsActorUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<{ analyticsUserId?: string | null }>()
    if (request.analyticsUserId === undefined) {
      throw new Error(
        '@AnalyticsActorUserId() used on a route without @UseGuards(AnalyticsEventsIdentityGuard) — identity not set',
      )
    }
    return request.analyticsUserId
  },
)
