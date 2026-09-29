// Harness — узкий модуль (тот же приём, что tenant-meta.controller.integration.spec.ts). Тенант запроса
// берётся из тестового заголовка `x-test-tenant-id`, вместо TenantResolutionMiddleware (он покрыт своим спеком).
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import type { Server } from 'node:http'
import { type INestApplication, Module, VersioningType } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { NEUTRAL_FALLBACK_PALETTE } from '@dorutj/contracts'
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter.js'
import { ResponseInterceptor } from '@/common/http/interceptors/response.interceptor.js'
import { AppConfigService } from '@/config/app-config.service.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { TENANT_REPOSITORY } from '@/modules/tenancy/application/ports/tenant-repository.port.js'
import { TENANT_SETTINGS_REPOSITORY } from '@/modules/tenancy/application/ports/tenant-settings-repository.port.js'
import { TENANT_EVENT_PUBLISHER, type TenantBrandingChange, type TenantEventPublisherPort } from '@/modules/tenancy/application/ports/tenant-event-publisher.port.js'
import { DrizzleTenantRepository } from '@/modules/tenancy/infrastructure/repositories/tenant.repository.js'
import { DrizzleTenantSettingsRepository } from '@/modules/tenancy/infrastructure/repositories/tenant-settings.repository.js'
import { GetBrandingUseCase } from '@/modules/tenancy/application/use-cases/get-branding.use-case.js'
import { UpdateBrandingUseCase } from '@/modules/tenancy/application/use-cases/update-branding.use-case.js'
import { TenancyBrandingController } from '@/modules/tenancy/presentation/controllers/tenancy-branding.controller.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const TENANT_HEADER = 'x-test-tenant-id'

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
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380/0',
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_tenancy_branding',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-integration',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  LOG_LEVEL: 'silent',
  JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
  JWT_KID: 'test-v1-tenancy-branding',
  CART_HOLD_TTL_SECONDS: '900',
}

const publishedEvents: TenantBrandingChange[] = []
const recordingPublisher: TenantEventPublisherPort = {
  publishBrandingUpdated: (event) => {
    publishedEvents.push(event)
    return Promise.resolve()
  },
}

@Module({
  imports: [AuthModule],
  controllers: [TenancyBrandingController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: DrizzleTenantRepository },
    { provide: TENANT_SETTINGS_REPOSITORY, useClass: DrizzleTenantSettingsRepository },
    { provide: TENANT_EVENT_PUBLISHER, useValue: recordingPublisher },
    GetBrandingUseCase,
    UpdateBrandingUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- модуль тест-харнесса
class TenancyBrandingTestModule {}

interface TestApp {
  readonly app: INestApplication
  readonly httpServer: Server
  readonly close: () => Promise<void>
}

function installTenantContextHook(app: NestFastifyApplication): void {
  app.getHttpAdapter().getInstance().addHook('onRequest', (req, _reply, done) => {
    const raw = req.headers[TENANT_HEADER]
    const tenantId = typeof raw === 'string' ? raw : null
    TenantContext.run(TenantContext.forTenant({ tenantId, slug: 'test-branding', chainId: null, isNeutral: false }), done)
  })
}

async function createTestApp(): Promise<TestApp> {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    process.env[key] ??= value
  }
  const { AppConfigModule } = await import('@/config/config.module.js')
  const { LoggerModule } = await import('@/common/logging/logger.module.js')
  const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
  const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')

  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, AuthModule, TenancyBrandingTestModule],
  }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  const config = app.get(AppConfigService)
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())
  app.getHttpAdapter().getInstance().server.setTimeout(config.requestTimeoutMs)
  installTenantContextHook(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return {
    app,
    httpServer: app.getHttpServer(),
    close: async (): Promise<void> => {
      const db = app.get<DrizzleDb>(DRIZZLE_DB) as DrizzleDb & { $client: Pool }
      await app.close()
      await db.$client.end()
    },
  }
}

interface BrandingBody {
  readonly data: { readonly slug: string; readonly brandName: string; readonly palette: Record<string, string>; readonly logoUrl: string | null }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly details?: { readonly field?: string } }
}

describe.skipIf(!postgresAvailable)('TenancyBrandingController — Supertest integration (DTJ-059)', () => {
  let pool: Pool
  let ctx: TestApp
  let jwtSigner: JwtSignerPort
  const seededTenantIds: string[] = []

  beforeAll(async () => {
    ctx = await createTestApp()
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
    publishedEvents.length = 0
  })

  function token(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedTenant(palette: Record<string, string> = {}): Promise<string> {
    const tenantId = randomUUID()
    await pool.query('INSERT INTO tenants (id, slug) VALUES ($1, $2)', [tenantId, `dtj059-${randomUUID().slice(0, 8)}`])
    await pool.query(`INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette) VALUES ($1, 'Seeded Brand', $2::jsonb)`, [
      tenantId,
      JSON.stringify(palette),
    ])
    seededTenantIds.push(tenantId)
    return tenantId
  }

  async function storedPalette(tenantId: string): Promise<Record<string, string>> {
    const { rows } = await pool.query<{ brand_palette: Record<string, string> }>('SELECT brand_palette FROM tenant_settings WHERE tenant_id = $1', [tenantId])
    return rows[0]?.brand_palette ?? {}
  }

  // resolvedAs — тенант, который middleware резолвит для запроса (у super_admin — без привязки, берём целевой).
  interface Caller {
    readonly token: string
    readonly resolvedAs: string | null
  }

  const putBranding = (caller: Caller, tenantId: string, body: unknown) =>
    request(ctx.httpServer)
      .put(`/api/v1/admin/tenants/${tenantId}/branding`)
      .set('Authorization', `Bearer ${caller.token}`)
      .set(TENANT_HEADER, caller.resolvedAs ?? tenantId)
      .send(body as object)

  const adminOf = (tenantId: string): Caller => ({
    token: token({ sub: randomUUID(), role: 'pharmacy_admin', tenantId, pharmacyId: null, chainId: null }),
    resolvedAs: tenantId,
  })
  const superAdmin = (): Caller => ({
    token: token({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null }),
    resolvedAs: null,
  })

  it('критерий 1: url(javascript:...) в --brand-primary → 400 VALIDATION_ERROR, details.field, БД не тронута', async () => {
    const tenantId = await seedTenant({ '--brand-primary': '#123456' })

    const response = await putBranding(adminOf(tenantId), tenantId, {
      brandName: 'X',
      brandPalette: { '--brand-primary': 'url(javascript:alert(1))' },
    })

    expect(response.status).toBe(400)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details?.field).toBe('--brand-primary')
    expect(await storedPalette(tenantId)).toEqual({ '--brand-primary': '#123456' })
    expect(publishedEvents).toHaveLength(0)
  })

  it('критерий 2: шрифт вне allowlist → 400 VALIDATION_ERROR', async () => {
    const tenantId = await seedTenant()
    const response = await putBranding(adminOf(tenantId), tenantId, {
      brandName: 'X',
      brandPalette: { '--brand-font-family': 'MyCustomHackerFont, sans-serif' },
    })
    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('критерий 3: свежий тенант (brand_palette = {}) → GET отдаёт NEUTRAL_FALLBACK_PALETTE', async () => {
    const tenantId = await seedTenant()

    const response = await request(ctx.httpServer).get('/api/v1/tenant/branding').set(TENANT_HEADER, tenantId)

    expect(response.status).toBe(200)
    const body = response.body as BrandingBody
    expect(body.data.palette).toEqual(NEUTRAL_FALLBACK_PALETTE)
    expect(body.data.brandName).toBe('Seeded Brand')
  })

  it('критерий 4: pharmacy_admin тенанта B → PUT в тенант A отклонён политикой (403), данные не изменены', async () => {
    const tenantA = await seedTenant({ '--brand-primary': '#111111' })
    const tenantB = await seedTenant()

    const response = await putBranding(adminOf(tenantB), tenantA, { brandName: 'Hijacked', brandPalette: { '--brand-primary': '#ff0000' } })

    expect(response.status).toBe(403)
    expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN')
    expect(await storedPalette(tenantA)).toEqual({ '--brand-primary': '#111111' })
  })

  it('pharmacy_admin своего тенанта: PUT сохраняет, возвращает новый брендинг и публикует событие', async () => {
    const tenantId = await seedTenant({ '--brand-accent': '#f59e0b' })

    const response = await putBranding(adminOf(tenantId), tenantId, {
      brandName: 'Sifat Plus',
      brandPalette: { '--brand-primary': '#0f766e' },
      logoUrl: 'https://cdn.example.com/logo.png',
    })

    expect(response.status).toBe(200)
    const body = response.body as BrandingBody
    expect(body.data).toMatchObject({ brandName: 'Sifat Plus', logoUrl: 'https://cdn.example.com/logo.png' })
    expect(body.data.palette).toEqual({ '--brand-accent': '#f59e0b', '--brand-primary': '#0f766e' })
    expect(publishedEvents).toHaveLength(1)
  })

  it('super_admin меняет брендинг любого тенанта; аноним и customer отклонены', async () => {
    const tenantId = await seedTenant()
    const payload = { brandName: 'By Super', brandPalette: {} }

    expect((await putBranding(superAdmin(), tenantId, payload)).status).toBe(200)
    const anonymous = await request(ctx.httpServer).put(`/api/v1/admin/tenants/${tenantId}/branding`).send(payload)
    expect(anonymous.status).toBe(401)
    const customer = { token: token({ sub: randomUUID(), role: 'customer', tenantId, pharmacyId: null, chainId: null }), resolvedAs: tenantId }
    expect((await putBranding(customer, tenantId, payload)).status).toBe(403)
  })

  it('GET: Cache-Control, ETag; If-None-Match с тем же ETag → 304 без тела', async () => {
    const tenantId = await seedTenant({ '--brand-primary': '#0f766e' })

    const first = await request(ctx.httpServer).get('/api/v1/tenant/branding').set(TENANT_HEADER, tenantId)
    expect(first.status).toBe(200)
    expect(first.headers['cache-control']).toBe('public, max-age=300')
    const etag = String(first.headers.etag)
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u)

    const second = await request(ctx.httpServer).get('/api/v1/tenant/branding').set(TENANT_HEADER, tenantId).set('If-None-Match', etag)
    expect(second.status).toBe(304)
    expect(second.text).toBe('')
  })

  it('критерий 5: после PUT устаревший If-None-Match → 200 с новым ETag, не 304', async () => {
    const tenantId = await seedTenant({ '--brand-primary': '#0f766e' })
    const before = await request(ctx.httpServer).get('/api/v1/tenant/branding').set(TENANT_HEADER, tenantId)
    const staleEtag = String(before.headers.etag)

    await putBranding(adminOf(tenantId), tenantId, { brandName: 'Renamed', brandPalette: { '--brand-primary': '#1d4ed8' } })

    const after = await request(ctx.httpServer).get('/api/v1/tenant/branding').set(TENANT_HEADER, tenantId).set('If-None-Match', staleEtag)
    expect(after.status).toBe(200)
    expect(after.headers.etag).not.toBe(staleEtag)
    expect((after.body as BrandingBody).data.brandName).toBe('Renamed')
  })
})
