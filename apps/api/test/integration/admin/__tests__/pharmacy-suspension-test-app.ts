import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { type INestApplication, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { AuditLogModule } from '@/common/audit/audit-log.module.js'
import { IdempotencyModule } from '@/common/idempotency/idempotency.module.js'
import { SharedKernelModule } from '@/shared-kernel/shared-kernel.module.js'
import { LoggerModule } from '@/common/logging/logger.module.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RequestContext } from '@/common/context/request-context.js'
import { OrdersCancellationStubModule } from './orders-cancellation-stub.module.js'

const BEARER_PREFIX = 'Bearer '

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_suspension',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-suspension',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
}

export interface SuspensionTestApp {
  readonly app: INestApplication
  readonly jwtSigner: JwtSignerPort
}

export async function createSuspensionTestApp(): Promise<SuspensionTestApp> {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
  if (process.env.JWT_PRIVATE_KEY === undefined || process.env.JWT_PUBLIC_KEY === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    process.env.JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    process.env.JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string
    process.env.JWT_KID = 'test-v1-suspension'
  }
  const moduleRef = await Test.createTestingModule({
    imports: [SharedKernelModule, LoggerModule, AuthModule, AuditLogModule, IdempotencyModule, OrdersCancellationStubModule, OnboardingModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (_request, _reply, done) => {
    RequestContext.run({ requestId: randomUUID(), tenantId: null, userId: null, role: null }, done)
  })
  fastify.addHook('onRequest', (request, _reply, done) => {
    const header = request.headers.authorization
    const verified = typeof header === 'string' && header.startsWith(BEARER_PREFIX) ? jwtSigner.verify(header.slice(BEARER_PREFIX.length)) : null
    const claims = verified?.ok === true ? verified.value : null
    TenantContext.run(
      TenantContext.forTenant({ tenantId: claims?.tenantId ?? null, slug: 'test-suspension', chainId: claims?.chainId ?? null, isNeutral: true }),
      done,
    )
  })
  await app.init()
  await fastify.ready()
  return { app, jwtSigner }
}
