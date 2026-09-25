// 1:1 приём InternalServiceGuard модуля orders — каждый модуль держит свою копию (payments/support — тот же приём).
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { AppConfigService } from '@/config/app-config.service.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

@Injectable()
export class DeliveryInternalServiceGuard implements CanActivate {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const provided = request.headers[INTERNAL_API_KEY_HEADER]
    if (!isValidInternalApiKey(typeof provided === 'string' ? provided : undefined, this.config.internalApiKey)) {
      throw new UnauthorizedException('invalid or missing x-internal-api-key')
    }
    return true
  }
}

export function isValidInternalApiKey(provided: string | undefined, expected: string | undefined): boolean {
  if (provided === undefined || expected === undefined || provided.length === 0) {
    return false
  }
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  if (providedBuf.length !== expectedBuf.length) {
    return false
  }
  return timingSafeEqual(providedBuf, expectedBuf)
}
