// Harness — узкий testing-модуль (тот же приём, что inventory-list.controller.integration.spec.ts).
// `TenantContext` резолвится ИЗ `claims.tenantId` самого Bearer-токена (тот же приём, что
// admin/__tests__/test-app.ts) — контроллер читает тенанта из TenantContext, не из claims напрямую,
// поэтому без этого хука `resolveTenantId()` кидал бы 500 (TenantScopeGuard в этом harness'е не
// поднят — минимальный модуль, не полный AppModule).
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import type { Server } from 'node:http'
import { type INestApplication, Module, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { TENANT_SETTINGS_REPOSITORY } from '@/modules/tenancy/application/ports/tenant-settings-repository.port.js'
import { DrizzleTenantSettingsRepository } from '@/modules/tenancy/infrastructure/repositories/tenant-settings.repository.js'
import { GetTenantMetaUseCase } from '@/modules/tenancy/application/use-cases/get-tenant-meta.use-case.js'
import { TenantMetaController } from '@/modules/tenancy/presentation/tenant-meta.controller.js'

const TEST_DATABASE_URL =
  process.env.TENANT_META_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

const { privateKey: TEST_JWT_PRIVATE_KEY, publicKey: TEST_JWT_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6380/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_tenant_meta',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-tenant-meta',
  CART_HOLD_TTL_SECONDS: '900',
}

function applyTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TenantMetaController],
  providers: [{ provide: TENANT_SETTINGS_REPOSITORY, useClass: DrizzleTenantSettingsRepository }, GetTenantMetaUseCase],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class TenantMetaTestModule {}

interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

/** `TenantContext` резолвится ИЗ `claims.tenantId` Bearer-токена — см. JSDoc файла и admin/__tests__/test-app.ts. */
function installTenantContextFromBearerHook(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance()
  fastify.addHook('onRequest', (req, _reply, done) => {
    const authHeader = req.headers.authorization
    const guest = { tenantId: null, slug: 'test-tenant-meta-guest', chainId: null, isNeutral: true }
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      TenantContext.run(TenantContext.forTenant(guest), done)
      return
    }
    const jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    const result = jwtSigner.verify(authHeader.slice('Bearer '.length))
    const store = result.ok
      ? { tenantId: result.value.tenantId, slug: 'test-tenant-meta', chainId: result.value.chainId, isNeutral: false }
      : guest
    TenantContext.run(TenantContext.forTenant(store), done)
  })
}

async function createTestApp(): Promise<TestApp> {
  applyTestEnv()
  const { AppConfigModule } = await import('@/config/config.module.js')
  const { LoggerModule } = await import('@/common/logging/logger.module.js')
  const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
  const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')

  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, AuthModule, TenantMetaTestModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installTenantContextFromBearerHook(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const httpServer = app.getHttpServer()
  return {
    app,
    httpServer,
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      await app.close()
      await db.$client.end()
    },
  }
}

interface SuccessBody {
  readonly data: { readonly inventoryDeltaSlaMinutes: number; readonly inventoryManualStaleHours: number }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('TenantMetaController — Supertest integration (DTJ-033)', () => {
  let pool: Pool
  let ctx: TestApp
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const seededTenantIds: string[] = []

  beforeAll(async () => {
    ctx = await createTestApp()
    httpServer = ctx.httpServer
    jwtSigner = ctx.app.get<JwtSignerPort>(JWT_SIGNER)
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
  })

  afterAll(async () => {
    await ctx.close()
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    if (seededTenantIds.length > 0) {
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [seededTenantIds])
      seededTenantIds.length = 0
    }
  })

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedTenantWithSla(inventoryDeltaSlaMinutes: number): Promise<string> {
    const tenantId = randomUUID()
    const slug = `dtj033-${randomUUID().slice(0, 8)}`
    await pool.query(`INSERT INTO tenants (id, slug) VALUES ($1, $2)`, [tenantId, slug])
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, inventory_delta_sla_minutes) VALUES ($1, 'Test Tenant DTJ-033', $2)`,
      [tenantId, inventoryDeltaSlaMinutes],
    )
    seededTenantIds.push(tenantId)
    return tenantId
  }

  it('критерий 1: inventory_delta_sla_minutes=15 у тенанта → GET /tenant/meta отдаёт inventoryDeltaSlaMinutes=15', async () => {
    const tenantId = await seedTenantWithSla(15)
    const token = sign({ sub: randomUUID(), role: 'pharmacist', tenantId, pharmacyId: randomUUID(), chainId: null })

    const response = await request(httpServer).get('/api/v1/tenant/meta').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    const body = response.body as SuccessBody
    expect(body.data.inventoryDeltaSlaMinutes).toBe(15)
    expect(body.data.inventoryManualStaleHours).toBeGreaterThan(0)
  })

  it('критерий 3: аноним → 401 UNAUTHENTICATED', async () => {
    const response = await request(httpServer).get('/api/v1/tenant/meta')
    expect(response.status).toBe(401)
    expect((response.body as ErrorBody).error.code).toBe('UNAUTHENTICATED')
  })

  it('роль customer → 403 INSUFFICIENT_ROLE (вне списка @Roles контроллера)', async () => {
    const tenantId = await seedTenantWithSla(5)
    const token = sign({ sub: randomUUID(), role: 'customer', tenantId, pharmacyId: null, chainId: null })

    const response = await request(httpServer).get('/api/v1/tenant/meta').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('pharmacy_admin с другим порогом (5) — читает свежее значение, не закешированное чужое', async () => {
    const tenantId = await seedTenantWithSla(5)
    const token = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId: null })

    const response = await request(httpServer).get('/api/v1/tenant/meta').set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect((response.body as SuccessBody).data.inventoryDeltaSlaMinutes).toBe(5)
  })
})
