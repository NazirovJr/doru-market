/**
 * `@CurrentUser()` (EP-01, DTJ-022) — параметр-декоратор контроллера, достаёт
 * `claims` (`JwtClaims`) из `request['authClaims']`, который `AuthGuard`
 * заполняет после успешной верификации JWT.
 *
 * Использование:
 *   ```ts
 *   @Get('me')
 *   @UseGuards(AuthGuard)
 *   me(@CurrentUser() user: JwtClaims): JwtClaims {
 *     return user
 *   }
 *   ```
 */
import { type ExecutionContext, createParamDecorator } from '@nestjs/common'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims => {
    const request = ctx.switchToHttp().getRequest<{ authClaims?: JwtClaims }>()
    if (request.authClaims === undefined) {
      throw new Error(
        '@CurrentUser() used on a route without @UseGuards(AuthGuard) — claims not set',
      )
    }
    return request.authClaims
  },
)
