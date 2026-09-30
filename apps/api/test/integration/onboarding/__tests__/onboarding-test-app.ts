// Harness публичных маршрутов заявки сети (DTJ-064): реальные AuthModule + OnboardingModule на Postgres/Redis.
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { AppConfigService } from '@/config/app-config.service.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AuditLogModule } from '@/common/audit/audit-log.module.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

const { privateKey: TEST_JWT_PRIVATE_KEY, publicKey: TEST_JWT_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

export const OTP_RATE_LIMIT_KEY_PREFIX = 'test:otp_rl_onboarding'

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX,
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-onboarding',
  CART_HOLD_TTL_SECONDS: '900',
}

const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001' // нейтральный тенант из миграции 0021

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

export async function createTestApp(): Promise<TestApp> {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuditLogModule, AuthModule, OnboardingModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (_request, _reply, done) => {
    RequestContext.run({ requestId: randomUUID(), tenantId: null, userId: null, role: null }, done)
  })
  fastify.addHook('onRequest', (_request, _reply, done) => {
    const store = TenantContext.forTenant({
      tenantId: NEUTRAL_TENANT_ID,
      slug: 'test-onboarding-neutral',
      chainId: null,
      isNeutral: true,
    })
    TenantContext.run(store, done)
  })
  await app.init()
  await fastify.ready()
  const redis = app.get<Redis>(REDIS_CLIENT)
  const stale = await redis.keys(`${OTP_RATE_LIMIT_KEY_PREFIX}:*`)
  if (stale.length > 0) {
    await redis.del(...stale)
  }
  return {
    app,
    httpServer: app.getHttpServer(),
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      await app.close()
      await db.$client.end()
      redis.disconnect()
    },
  }
}
