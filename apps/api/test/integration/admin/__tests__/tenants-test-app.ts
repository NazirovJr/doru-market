/**
 * `tenants-test-app.ts` (EP-15, DTJ-351) — Supertest-harness `TenantsController` против
 * РЕАЛЬНЫХ Postgres/Redis. Копия приёма `test-app.ts` (DTJ-352, feature-flags) — «КАЖДЫЙ
 * модуль несёт СВОЮ копию harness'а» — но с ДРУГИМ DI-графом: `TenantsController` читает
 * реальные `tenants`/`tenant_settings` через `TenancyModule` (не самодостаточный домен, как
 * `feature_flags`) и пишет аудит через `AuditLogModule` (`UpdateTenantSettingsUseCase`).
 *
 * `installDefaultTenantContextHook` — ОБЯЗАТЕЛЕН: `TenancyModule` регистрирует глобальный
 * `TenantScopeGuard` (`APP_GUARD`), которому нужен резолвленный `TenantContext` ДО контроллера
 * (см. JSDoc `tenant-scope.guard.ts`) — этот harness не поднимает `TenantResolutionMiddleware`
 * (Host/slug резолвинг), поэтому резолвит контекст напрямую из claims Bearer-токена, тот же
 * приём, что `test-app.ts` (DTJ-352).
 */
import { randomUUID } from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'
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
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { AuditLogModule } from '@/common/audit/audit-log.module.js'
import { TenantsController } from '@/modules/admin/presentation/tenants.controller.js'
import { TENANCY_FACADE_PORT_PROVIDER } from '@/modules/admin/infrastructure/adapters/tenancy-facade.adapter.js'
import { ListTenantsUseCase } from '@/modules/admin/application/use-cases/list-tenants.use-case.js'
import { GetTenantUseCase } from '@/modules/admin/application/use-cases/get-tenant.use-case.js'
import { UpdateTenantSettingsUseCase } from '@/modules/admin/application/use-cases/update-tenant-settings.use-case.js'
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_admin_tenants',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-admin-tenants',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

/**
 * См. JSDoc файла — минимальный модуль вместо полного `AdminModule` (не тянет onboarding/orders/
 * payments). `imports: [TenancyModule]` ЗДЕСЬ, не только на верхнем уровне `Test.
 * createTestingModule` — Nest-инкапсуляция: экспорт соседнего модуля виден только модулю,
 * который его явно импортирует (1:1 приём реального `admin.module.ts`).
 */
@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [TenantsController],
  providers: [TENANCY_FACADE_PORT_PROVIDER, ListTenantsUseCase, GetTenantUseCase, UpdateTenantSettingsUseCase],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль тест-harness'а, см. комментарий выше
class TenantsTestModule {}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const BEARER_PREFIX = 'Bearer '

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule, AuditLogModule, TenancyModule, TenantsTestModule],
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

/** 1:1 приём `test-app.ts` (DTJ-352) «installDefaultRequestContextHook». */
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

/** См. JSDoc файла — `TenantContext` резолвится ИЗ `claims.tenantId` самого Bearer-токена. */
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
  const guest = { tenantId: null, slug: 'test-admin-tenants-guest', chainId: null, isNeutral: true }
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
    slug: 'test-admin-tenants-guest',
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
