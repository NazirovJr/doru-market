import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { type Server } from 'node:http'
import { type INestApplication, Module, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import type Redis from 'ioredis'
import type { Pool } from 'pg'
import { AppConfigService } from '@/config/app-config.service.js'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { AuditLogModule } from '@/common/audit/audit-log.module.js'
import { IdempotencyModule } from '@/common/idempotency/idempotency.module.js'
import { PharmacyApiKeysController } from '@/modules/admin/presentation/pharmacy-api-keys.controller.js'
import { ONBOARDING_FACADE_PORT } from '@/modules/admin/application/ports/onboarding-facade.port.js'
import { INVENTORY_FACADE_PORT } from '@/modules/admin/application/ports/inventory-facade.port.js'
import { CreatePharmacyApiKeyUseCase } from '@/modules/admin/application/use-cases/create-pharmacy-api-key.use-case.js'
import { ListPharmacyApiKeysUseCase } from '@/modules/admin/application/use-cases/list-pharmacy-api-keys.use-case.js'
import { RevokePharmacyApiKeyUseCase } from '@/modules/admin/application/use-cases/revoke-pharmacy-api-key.use-case.js'
import { RotatePharmacyApiKeyUseCase } from '@/modules/admin/application/use-cases/rotate-pharmacy-api-key.use-case.js'
import { SetPharmacyApiKeyMtlsUseCase } from '@/modules/admin/application/use-cases/set-pharmacy-api-key-mtls.use-case.js'
import { InventoryModule } from '@/modules/inventory/inventory.module.js'
import { InventoryFacade } from '@/modules/inventory/index.js'
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

export const TEST_INTERNAL_API_KEY = 'test-internal-key-dtj365'

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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_admin_pharmacy_api_keys',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-admin-pharmacy-api-keys',
  CART_HOLD_TTL_SECONDS: '900',
  API_KEY_ROTATION_GRACE_PERIOD_HOURS: '24',
  INTERNAL_API_KEY: TEST_INTERNAL_API_KEY,
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  // InventoryModule уже регистрирует RevokeExpiredRotatedKeyController — не дублировать.
  imports: [AuthModule, OnboardingModule, InventoryModule],
  controllers: [PharmacyApiKeysController],
  providers: [
    { provide: ONBOARDING_FACADE_PORT, useExisting: OnboardingFacade },
    { provide: INVENTORY_FACADE_PORT, useExisting: InventoryFacade },
    CreatePharmacyApiKeyUseCase,
    ListPharmacyApiKeysUseCase,
    RevokePharmacyApiKeyUseCase,
    RotatePharmacyApiKeyUseCase,
    SetPharmacyApiKeyMtlsUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class PharmacyApiKeysAdminTestModule {}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const BEARER_PREFIX = 'Bearer '

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule, AuditLogModule, IdempotencyModule, PharmacyApiKeysAdminTestModule],
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
  const guest = { tenantId: null, slug: 'test-admin-pharmacy-api-keys-guest', chainId: null, isNeutral: true }
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
    slug: 'test-admin-pharmacy-api-keys-guest',
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
