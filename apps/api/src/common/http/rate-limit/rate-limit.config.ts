/**
 * Глобальный rate-limit `apps/api` (DTJ-432). Опции `@fastify/rate-limit` — Redis-хранилище,
 * ключ/лимит по auth-статусу, исключения для health/internal/webhook.
 */
import { HttpException } from '@nestjs/common'
import { type RateLimitPluginOptions, normalizeIP } from '@fastify/rate-limit'
import type { FastifyRequest } from 'fastify'
import type Redis from 'ioredis'
import { ErrorCode, fail } from '@dorutj/contracts'
import { type JwtSignerPort } from '@/modules/auth/index.js'
import type { AppConfigService } from '@/config/app-config.service.js'
import { HTTP_STATUS_TOO_MANY_REQUESTS } from '../http-status.constants.js'

const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
export const RATE_LIMIT_WINDOW_MS = SECONDS_PER_MINUTE * MS_PER_SECOND

const KEY_PREFIX_USER = 'user'
const KEY_PREFIX_IP = 'ip'
const BEARER_PREFIX = 'Bearer '
const RATE_LIMIT_NAMESPACE = 'dorutj-rate-limit:'

const EXEMPT_EXACT_PATHS = new Set(['/health', '/ready'])
const EXEMPT_PATH_PREFIXES = ['/api/v1/internal/', '/api/v1/payments/webhook']

export function isRateLimitExemptPath(url: string): boolean {
  const path = url.split('?')[0] ?? url
  return EXEMPT_EXACT_PATHS.has(path) || EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
}

// Верифицируем подпись — непроверенный `sub` дал бы анонимному запросу с любым Bearer обход IP-лимита.
export function resolveRateLimitKey(request: FastifyRequest, jwtSigner: JwtSignerPort): string {
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith(BEARER_PREFIX)) {
    const result = jwtSigner.verify(authHeader.slice(BEARER_PREFIX.length))
    if (result.ok) {
      return `${KEY_PREFIX_USER}:${result.value.sub}`
    }
  }
  return `${KEY_PREFIX_IP}:${normalizeIP(request.ip)}`
}

function resolveMax(config: AppConfigService, key: string): number {
  return key.startsWith(`${KEY_PREFIX_USER}:`) ? config.rateLimitUserPerMin : config.rateLimitAnonPerMin
}

export interface RateLimitDependencies {
  readonly redis: Redis
  readonly jwtSigner: JwtSignerPort
}

/** Опции для `app.register(rateLimit, ...)` — регистрируется в `main.ts` рядом с helmet/cors. */
export function buildRateLimitOptions(
  config: AppConfigService,
  deps: RateLimitDependencies,
): RateLimitPluginOptions {
  return {
    redis: deps.redis,
    nameSpace: RATE_LIMIT_NAMESPACE,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    allowList: (request: FastifyRequest): boolean => isRateLimitExemptPath(request.url),
    keyGenerator: (request: FastifyRequest): string => resolveRateLimitKey(request, deps.jwtSigner),
    max: (_request: FastifyRequest, key: string): number => resolveMax(config, key),
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    // `AllExceptionsFilter` понимает `HttpException` с телом `{ error: { code, message } }`
    // (`readErrorSource`/`extractErrorCode`) — тот же путь, что гварды `AuthGuard`/`RolesGuard`.
    errorResponseBuilder: (_request: FastifyRequest, context: { after: string }): HttpException =>
      new HttpException(
        fail(ErrorCode.RATE_LIMITED, `Rate limit exceeded, retry in ${context.after}`),
        HTTP_STATUS_TOO_MANY_REQUESTS,
      ),
  }
}
