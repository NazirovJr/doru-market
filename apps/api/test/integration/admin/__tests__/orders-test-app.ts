// Реальные ORDERS_FACADE/PAYMENTS_FACADE через useExisting (не фейки) — OrdersModule импортирует PaymentsModule внутри себя, одного imports достаточно для обоих.
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
import { OrdersModule } from '@/modules/orders/orders.module.js'
import { ORDERS_FACADE, ORDER_CANCELLATION } from '@/modules/orders/index.js'
import { PaymentsModule } from '@/modules/payments/payments.module.js'
import { PAYMENTS_FACADE } from '@/modules/payments/index.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { AuditLogModule } from '@/common/audit/audit-log.module.js'
import { IdempotencyModule } from '@/common/idempotency/idempotency.module.js'
import { DomainEventsModule } from '@/common/events/domain-events.module.js'
import { OrdersAdminController } from '@/modules/admin/presentation/orders-admin.controller.js'
import { OrdersAdminActionsController } from '@/modules/admin/presentation/orders-admin-actions.controller.js'
import { ORDERS_FACADE_PORT } from '@/modules/admin/application/ports/orders-facade.port.js'
import { ORDER_CANCELLATION_PORT } from '@/modules/admin/application/ports/order-cancellation.port.js'
import { PAYMENTS_FACADE_PORT } from '@/modules/admin/application/ports/payments-facade.port.js'
import { PRESCRIPTIONS_FACADE_PORT } from '@/modules/admin/application/ports/prescriptions-facade.port.js'
import { ONBOARDING_FACADE_PORT } from '@/modules/admin/application/ports/onboarding-facade.port.js'
import { NullPrescriptionsFacadeAdapter } from '@/modules/admin/infrastructure/adapters/null-prescriptions-facade.adapter.js'
import { ListOrdersAnyUseCase } from '@/modules/admin/application/use-cases/list-orders-any.use-case.js'
import { ListOrdersOwnUseCase } from '@/modules/admin/application/use-cases/list-orders-own.use-case.js'
import { GetOrderDetailAdminUseCase } from '@/modules/admin/application/use-cases/get-order-detail-admin.use-case.js'
import { AdminPaymentOverrideUseCase } from '@/modules/admin/application/use-cases/admin-payment-override.use-case.js'
import { AdminForceCancelOrderUseCase } from '@/modules/admin/application/use-cases/admin-force-cancel-order.use-case.js'
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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_admin_orders',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-admin-orders',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_DRIVER: 'mock_bank',
  MOCK_BANK_WEBHOOK_SECRET: 'test-mock-bank-webhook-secret-admin-orders',
  MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  imports: [AuthModule, OrdersModule, PaymentsModule, OnboardingModule],
  controllers: [OrdersAdminController, OrdersAdminActionsController],
  providers: [
    { provide: ORDERS_FACADE_PORT, useExisting: ORDERS_FACADE },
    { provide: ORDER_CANCELLATION_PORT, useExisting: ORDER_CANCELLATION },
    { provide: PAYMENTS_FACADE_PORT, useExisting: PAYMENTS_FACADE },
    { provide: PRESCRIPTIONS_FACADE_PORT, useClass: NullPrescriptionsFacadeAdapter },
    { provide: ONBOARDING_FACADE_PORT, useExisting: OnboardingFacade },
    ListOrdersAnyUseCase,
    ListOrdersOwnUseCase,
    GetOrderDetailAdminUseCase,
    // DTJ-356 — payment-override/admin-force-cancel.
    AdminPaymentOverrideUseCase,
    AdminForceCancelOrderUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class OrdersAdminTestModule {}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const BEARER_PREFIX = 'Bearer '

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, IdempotencyModule, AuditLogModule, DomainEventsModule, AuthModule, OrdersAdminTestModule],
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
  const guest = { tenantId: null, slug: 'test-admin-orders-guest', chainId: null, isNeutral: true }
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
    slug: 'test-admin-orders-guest',
    chainId: result.value.chainId,
    isNeutral: result.value.tenantId === null,
  }
}
