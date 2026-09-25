// Supertest-harness AnalyticsEventsController: тот же трюк, что orders/__tests__/test-app.ts —
// гость резолвит TenantContext в фиксированный GUEST_TENANT_ID вместо реального middleware.
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { type Server } from 'node:http'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { AppConfigService } from '@/config/app-config.service.js'
import { AppConfigModule } from '@/config/config.module.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { DatabaseModule } from '@/infrastructure/database/database.module.js'
import { RedisModule } from '@/infrastructure/redis/redis.module.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { AnalyticsModule } from '@/modules/analytics/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

const BEARER_PREFIX = 'Bearer '

const { privateKey: TEST_JWT_PRIVATE_KEY, publicKey: TEST_JWT_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

export const GUEST_TENANT_ID = '88888888-8888-4888-8888-888888888888' // тест обязан посеять tenants с этим id
const GUEST_SLUG = 'test-analytics-guest'

function testEnv(databaseUrl: string, redisUrl: string): Readonly<Record<string, string>> {
  return {
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    REQUEST_TIMEOUT_MS: '30000',
    CORS_STATIC_ORIGINS: 'http://localhost:3000',
    MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
    OTP_REQUEST_COOLDOWN_SECONDS: '60',
    OTP_REQUEST_MAX_PER_10MIN: '3',
    OTP_REQUEST_MAX_PER_DAY: '10',
    OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
    OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_analytics_events',
    OTP_VERIFY_MAX_ATTEMPTS: '5',
    TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-analytics-events-e2e',
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
    LOG_LEVEL: 'silent',
    JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
    JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
    JWT_KID: 'test-v1-analytics-events',
    CART_HOLD_TTL_SECONDS: '900',
    PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  }
}

function applyTestEnv(databaseUrl: string, redisUrl: string): void {
  for (const [key, value] of Object.entries(testEnv(databaseUrl, redisUrl))) {
    process.env[key] = value
  }
}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

export async function createTestApp(databaseUrl: string, redisUrl: string): Promise<TestApp> {
  applyTestEnv(databaseUrl, redisUrl)
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, SharedKernelModule, LoggerModule, DatabaseModule, RedisModule, AuthModule, AnalyticsModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installDefaultRequestContextHook(app)
  installDefaultTenantContextHook(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      const redis = app.get<Redis>(REDIS_CLIENT)
      await app.close()
      await db.$client.end()
      redis.disconnect()
    },
  }
}

function installDefaultRequestContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (_request, _reply, done) => {
    if (RequestContext.get() !== undefined) {
      done()
      return
    }
    RequestContext.run({ requestId: randomUUID(), tenantId: null, userId: null, role: null }, done)
  })
}

function installDefaultTenantContextHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (request, _reply, done) => {
    if (TenantContext.get() !== undefined) {
      done()
      return
    }
    const store = TenantContext.forTenant(resolveFromBearerClaims(app, request.headers.authorization))
    TenantContext.run(store, done)
  })
}

function resolveFromBearerClaims(
  app: NestFastifyApplication,
  authHeader: string | undefined,
): { tenantId: string | null; slug: string; chainId: string | null; isNeutral: boolean } {
  const guest = { tenantId: GUEST_TENANT_ID, slug: GUEST_SLUG, chainId: null, isNeutral: false }
  if (typeof authHeader !== 'string' || !authHeader.startsWith(BEARER_PREFIX)) {
    return guest
  }
  const token = authHeader.slice(BEARER_PREFIX.length)
  const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  const result = jwtSigner.verify(token)
  if (!result.ok) {
    return guest
  }
  return {
    tenantId: result.value.tenantId,
    slug: GUEST_SLUG,
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
