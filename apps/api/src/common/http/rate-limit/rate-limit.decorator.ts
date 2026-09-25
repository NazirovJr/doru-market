/**
 * `@RateLimit` (DTJ-432) — переопределение лимита на маршруте через `RouteConfig`
 * (нативный merge `@fastify/rate-limit`, без своего хранилища счётчиков). Единственный канал —
 * `keyBy: 'pharmacyId'`: ключ — `keyId` из `X-Pharmacy-API-Key: {keyId}.{secret}`, без проверки
 * подписи (тот же уровень доверия, что `phone` у лимитера OTP).
 */
import { RouteConfig } from '@nestjs/platform-fastify'
import type { FastifyRequest } from 'fastify'
import { envSchema } from '@/config/env.schema.js'

export type RateLimitKeyBy = 'pharmacyId'

export interface RateLimitOverride {
  /** Литерал или геттер (декоратор вычисляется при загрузке модуля, до валидации ENV). */
  readonly max: number | (() => number)
  readonly windowSec: number
  readonly keyBy: RateLimitKeyBy
}

const MS_PER_SECOND = 1000
const PHARMACY_KEY_HEADER = 'x-pharmacy-api-key'
const PHARMACY_KEY_PREFIX = 'pharmacy'
const UNKNOWN_PHARMACY_KEY = 'unknown'

function resolvePharmacyKeyId(request: FastifyRequest): string {
  const header = request.headers[PHARMACY_KEY_HEADER]
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined) {
    return UNKNOWN_PHARMACY_KEY
  }
  const dotIndex = value.indexOf('.')
  return dotIndex > 0 ? value.slice(0, dotIndex) : UNKNOWN_PHARMACY_KEY
}

function pharmacyKeyGenerator(request: FastifyRequest): string {
  return `${PHARMACY_KEY_PREFIX}:${resolvePharmacyKeyId(request)}`
}

/** Переиспользует Zod-валидацию `env.schema.ts` для одного поля — без дублирования правила. */
export function resolveRateLimit1cBatchPerMin(): number {
  return envSchema.shape.RATE_LIMIT_1C_BATCH_PER_MIN.parse(process.env.RATE_LIMIT_1C_BATCH_PER_MIN)
}

function toRouteMax(max: number | (() => number)): number | ((request: FastifyRequest) => number) {
  return typeof max === 'function' ? (): number => max() : max
}

export const RateLimit = (options: RateLimitOverride): MethodDecorator & ClassDecorator => {
  return RouteConfig({
    rateLimit: {
      max: toRouteMax(options.max),
      timeWindow: options.windowSec * MS_PER_SECOND,
      keyGenerator: pharmacyKeyGenerator,
    },
  })
}
