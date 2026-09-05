/**
 * `InternalServiceGuard` (EP-10, DTJ-253/254) — защита маршрутов service-to-service
 * (`apps/worker → apps/api`, никогда не браузер/мобильный клиент). Сравнивает заголовок
 * `x-internal-api-key` с `INTERNAL_API_KEY` (ENV) константным по времени сравнением
 * (`timingSafeEqual`, тот же приём, что `verifyHmacSha256Signature`, DTJ-239) — простой
 * shared-secret, НЕ HMAC-подпись тела: обе стороны — процессы ОДНОГО деплоя под нашим
 * контролем, а не внешний банк, чью подпись нужно верифицировать по содержимому.
 *
 * `INTERNAL_API_KEY` не настроен → отказ ЛЮБОМУ запросу (безопасный дефолт для секрета —
 * противоположность безопасному дефолту для данных, см. D-EP09-16 в другом контексте).
 *
 * `401`, не `404` (в отличие от `MockBankDevAccessGuard`, DTJ-238): тот маршрут — dev-переключатель,
 * которому положено быть неразличимым от «не существует» в проде; этот — постоянный прод-маршрут
 * (worker обязан достигать его ВСЕГДА, включая прод), неверный секрет здесь — обычная ошибка
 * авторизации, не повод скрывать существование маршрута.
 */
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { AppConfigService } from '@/config/app-config.service.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

@Injectable()
export class InternalServiceGuard implements CanActivate {
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

/** Экспортирована для юнит-теста прямого сравнения (без поднятия Nest-контекста). */
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
