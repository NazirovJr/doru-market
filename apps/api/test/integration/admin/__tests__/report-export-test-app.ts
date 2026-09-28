// Supertest-harness ReportExportController (копия приёма finance-test-app.ts) — реальные Postgres/Redis/BullMQ (не фейки: сама схема export_jobs/очередь и есть предмет проверки этого тикета), DTJ-361.
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
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { ReportExportController } from '@/modules/admin/presentation/report-export.controller.js'
import { REPORT_EXPORT_RENDERER, REPORT_EXPORT_QUEUE, EXPORT_JOBS_REPOSITORY } from '@/modules/admin/application/ports/report-export.port.js'
import { ReportExportRendererAdapter } from '@/modules/admin/infrastructure/adapters/report-export-renderer.adapter.js'
import { BullmqReportExportQueueAdapter } from '@/modules/admin/infrastructure/adapters/bullmq-report-export-queue.adapter.js'
import { DrizzleExportJobsRepository } from '@/modules/admin/infrastructure/repositories/export-jobs.repository.js'
import { RequestReportExportDeps, RequestReportExportUseCase } from '@/modules/admin/application/use-cases/request-report-export.use-case.js'
import { GetExportJobStatusUseCase } from '@/modules/admin/application/use-cases/get-export-job-status.use-case.js'

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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_admin_report_export',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-admin-report-export',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ReportExportController],
  providers: [
    { provide: REPORT_EXPORT_RENDERER, useClass: ReportExportRendererAdapter },
    { provide: REPORT_EXPORT_QUEUE, useClass: BullmqReportExportQueueAdapter },
    { provide: EXPORT_JOBS_REPOSITORY, useClass: DrizzleExportJobsRepository },
    RequestReportExportDeps,
    RequestReportExportUseCase,
    GetExportJobStatusUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class ReportExportTestModule {}

export interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

const BEARER_PREFIX = 'Bearer '

export async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule, ReportExportTestModule],
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
  fastify.addHook('onRequest', (_request, _reply, done) => {
    if (TenantContext.get() !== undefined) {
      done()
      return
    }
    TenantContext.run(TenantContext.forTenant({ tenantId: null, slug: 'test-admin-report-export-guest', chainId: null, isNeutral: true }), done)
  })
}

export { BEARER_PREFIX }
