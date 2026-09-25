// DTJ-364: harness для StaffAccountsController + auth POST /staff-accounts (DTJ-030) на реальных
// Postgres/Redis — копия приёма users-test-app.ts + DeliveryModule (provision-courier).
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
import type { UserRole } from '@dorutj/contracts'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, USERS_REPOSITORY, type JwtSignerPort, type UsersRepository } from '@/modules/auth/index.js'
import { DeliveryModule } from '@/modules/delivery/delivery.module.js'
import { StaffAccountsController } from '@/modules/admin/presentation/staff-accounts.controller.js'
import { IDENTITY_FACADE_PORT_PROVIDER } from '@/modules/admin/infrastructure/adapters/identity-facade.adapter.js'
import { DELIVERY_FACADE_PORT_PROVIDER } from '@/modules/admin/infrastructure/adapters/delivery-facade.adapter.js'
import { ListStaffAccountsUseCase } from '@/modules/admin/application/use-cases/list-staff-accounts.use-case.js'
import { DeactivateStaffAccountUseCase } from '@/modules/admin/application/use-cases/deactivate-staff-account.use-case.js'
import { CreateStaffAccountUseCase } from '@/modules/admin/application/use-cases/create-staff-account.use-case.js'
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_staff_accounts',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-staff-accounts',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  imports: [AuthModule, DeliveryModule],
  controllers: [StaffAccountsController],
  providers: [
    IDENTITY_FACADE_PORT_PROVIDER,
    DELIVERY_FACADE_PORT_PROVIDER,
    ListStaffAccountsUseCase,
    DeactivateStaffAccountUseCase,
    CreateStaffAccountUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class StaffAccountsAdminTestModule {}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const BEARER_PREFIX = 'Bearer '

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule, StaffAccountsAdminTestModule],
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
  const guest = { tenantId: null, slug: 'test-staff-accounts-guest', chainId: null, isNeutral: true }
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
    slug: 'test-staff-accounts-guest',
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}

// Сидирует actor'а напрямую в users, минуя OTP — приём create-staff-account.spec.ts (DTJ-030).
export async function seedActor(
  app: INestApplication,
  role: UserRole,
  chainId: string | null,
): Promise<{ userId: string; accessToken: string }> {
  const users = app.get<UsersRepository>(USERS_REPOSITORY)
  const phone = `+992${randomUUID().replace(/-/g, '').slice(0, 9)}`
  const created = await users.create({ tenantId: randomUUID(), phoneNumber: phone, role, fullName: 'Test Actor', pharmacyId: null, chainId }) // tenantId ≠ chainId, изоляция по chainId
  const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  const accessToken = jwtSigner.sign({
    sub: created.id,
    role: created.role,
    tenantId: created.tenantId,
    pharmacyId: created.pharmacyId,
    chainId: created.chainId,
    sessionId: randomUUID(),
  })
  return { userId: created.id, accessToken }
}
