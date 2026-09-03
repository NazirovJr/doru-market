/**
 * `PaymentsInternalServiceGuard` (EP-10, DTJ-244) — защита `POST /api/v1/internal/orders/:id/
 * delivered` (временный мост `OrderDeliveredSubscriber`, см. её JSDoc). Тот же секрет
 * (`INTERNAL_API_KEY`) и та же логика, что `orders/presentation/internal/internal-service.
 * guard.ts` (DTJ-253/254) — НЕ импортирован оттуда (межмодульный `presentation`-импорт не
 * проходит через публичный фасад, `02` §1.2, `no-cross-module-deep-import`), это НЕОБХОДИМОЕ
 * дублирование через границу модуля (тот же класс решения, что `EscrowLedgerImbalanceMetric`
 * через границу процесса) — гвард как концепция не принадлежит ни `orders`, ни `payments`
 * семантически, дублировать ~20 строк дешевле, чем городить общий пакет ради одного класса.
 */
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { AppConfigService } from '@/config/app-config.service.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

@Injectable()
export class PaymentsInternalServiceGuard implements CanActivate {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const provided = request.headers[INTERNAL_API_KEY_HEADER]
    if (!isValidKey(typeof provided === 'string' ? provided : undefined, this.config.internalApiKey)) {
      throw new UnauthorizedException('invalid or missing x-internal-api-key')
    }
    return true
  }
}

function isValidKey(provided: string | undefined, expected: string | undefined): boolean {
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
