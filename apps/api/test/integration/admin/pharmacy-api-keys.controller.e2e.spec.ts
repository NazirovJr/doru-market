import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import {
  PHARMACY_API_KEY_VERIFICATION,
  type PharmacyApiKeyVerificationPort,
} from '@/modules/inventory/application/ports/pharmacy-api-key-verification.port.js'
import { PharmacyApiKeyInvalidError } from '@dorutj/contracts'
import { createTestApp, TEST_INTERNAL_API_KEY, type TestApp } from './__tests__/pharmacy-api-keys-test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test_dtj365'
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

interface SuccessBody<T> {
  readonly data: T
}
interface ErrorBody {
  readonly error: { readonly code: string }
}
interface CreatedKeyBody {
  readonly id: string
  readonly apiKey: string
  readonly hmacSecret: string
  readonly keyPrefix: string
}
interface SummaryBody {
  readonly id: string
  readonly isActive: boolean
  readonly keyPrefix: string
}
interface AuditLogRow {
  readonly category: string
  readonly action: string
  readonly entity_id: string
  readonly metadata: Record<string, unknown>
}

const TEST_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('PharmacyApiKeysController — Supertest integration (DTJ-365)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let verification: PharmacyApiKeyVerificationPort
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  const createdUserIds: string[] = []

  async function sign(role: string, extra?: Partial<JwtClaims>): Promise<string> {
    const sub = randomUUID()
    await pool.query('INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)', [sub, TEST_TENANT_ID, role])
    createdUserIds.push(sub)
    return jwtSigner.sign({
      sub,
      role: role as JwtClaims['role'],
      tenantId: TEST_TENANT_ID,
      pharmacyId: null,
      chainId: null,
      sessionId: randomUUID(),
      ...extra,
    })
  }

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $2, $3, 'active')`,
      [id, name, `tin-${id.slice(0, 8)}`],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(name: string, chainId: string | null = null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str.', 38.5598, 68.7870, '+992900000001', 'active')`,
      [id, chainId, name],
    )
    createdPharmacyIds.push(id)
    return id
  }

  function createKey(token: string, pharmacyId: string): request.Test {
    return request(httpServer).post(`/api/v1/pharmacy-accounts/${pharmacyId}/api-keys`).set('Authorization', `Bearer ${token}`)
  }

  function listKeys(token: string, pharmacyId: string): request.Test {
    return request(httpServer).get(`/api/v1/pharmacy-accounts/${pharmacyId}/api-keys`).set('Authorization', `Bearer ${token}`)
  }

  function revokeKey(params: { token: string; pharmacyId: string; keyId: string; reason: string }): request.Test {
    return request(httpServer)
      .post(`/api/v1/pharmacy-accounts/${params.pharmacyId}/api-keys/${params.keyId}/revoke`)
      .set('Authorization', `Bearer ${params.token}`)
      .send({ reason: params.reason })
  }

  function rotateKey(params: { token: string; pharmacyId: string; keyId: string; idempotencyKey: string }): request.Test {
    return request(httpServer)
      .post(`/api/v1/pharmacy-accounts/${params.pharmacyId}/api-keys/${params.keyId}/rotate`)
      .set('Authorization', `Bearer ${params.token}`)
      .set('Idempotency-Key', params.idempotencyKey)
  }

  function verifyInputFor(apiKey: string, secret: string): {
    keyId: string
    secret: string
    timestamp: string
    nonce: string
    signature: string
    method: string
    path: string
    rawBody: Buffer
    mtlsVerifiedHeader: undefined
  } {
    const [keyId] = apiKey.split('.')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomUUID()
    const rawBody = Buffer.alloc(0)
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    const canonical = `POST\n/test\n${timestamp}\n${nonce}\n${bodyHash}`
    const signature = createHmac('sha256', secret).update(canonical).digest('hex')
    return { keyId: keyId ?? '', secret, timestamp, nonce, signature, method: 'POST', path: '/test', rawBody, mtlsVerifiedHeader: undefined }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    verification = app.get<PharmacyApiKeyVerificationPort>(PHARMACY_API_KEY_VERIFICATION)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM pharmacy_api_keys WHERE pharmacy_id = ANY($1)', [createdPharmacyIds])
      if (createdPharmacyIds.length > 0) {
        await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      }
      if (createdChainIds.length > 0) {
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.end().catch(() => undefined)
    }
  })

  it('create — секрет виден РОВНО в этом ответе; list той же аптеки НЕ содержит apiKey/hmacSecret (TC-ADM-017)', async () => {
    const chainId = await seedChain(`Own Chain ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(`Pharmacy ${randomUUID().slice(0, 8)}`, chainId)
    const token = await sign('pharmacy_admin', { chainId })

    const createRes = await createKey(token, pharmacyId)
    expect(createRes.status).toBe(201)
    const created = (createRes.body as SuccessBody<CreatedKeyBody>).data
    expect(created.apiKey).toContain('.')
    expect(created.hmacSecret.length).toBeGreaterThan(0)

    const listRes = await listKeys(token, pharmacyId)
    expect(listRes.status).toBe(200)
    const listBody = JSON.stringify(listRes.body)
    expect(listBody).not.toContain(created.hmacSecret)
    expect(listBody).not.toContain(created.apiKey)
    const summaries = (listRes.body as SuccessBody<readonly SummaryBody[]>).data
    expect(summaries.find((s) => s.id === created.id)?.isActive).toBe(true)

    const auditRows = (await pool.query<AuditLogRow>('SELECT category, action, entity_id, metadata FROM audit_log WHERE entity_id = $1', [created.id])).rows
    expect(auditRows.some((r) => r.category === 'pharmacy_api_key' && r.action === 'create')).toBe(true)
    expect(JSON.stringify(auditRows)).not.toContain(created.hmacSecret)
  })

  it('pharmacy_admin чужой сети → 403 CROSS_TENANT_ACCESS_DENIED, ключ не создаётся', async () => {
    const chainA = await seedChain(`Chain A ${randomUUID().slice(0, 8)}`)
    const chainB = await seedChain(`Chain B ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(`Pharmacy B ${randomUUID().slice(0, 8)}`, chainB)
    const token = await sign('pharmacy_admin', { chainId: chainA })

    const res = await createKey(token, pharmacyId)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('revoke — is_active=false, audit_log с action=revoke, старый ключ более не проходит verify', async () => {
    const chainId = await seedChain(`Revoke Chain ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(`Revoke Pharmacy ${randomUUID().slice(0, 8)}`, chainId)
    const token = await sign('pharmacy_admin', { chainId })
    const created = (await createKey(token, pharmacyId)).body as SuccessBody<CreatedKeyBody>

    const revokeRes = await revokeKey({ token, pharmacyId, keyId: created.data.id, reason: 'скомпрометирован' })
    expect(revokeRes.status).toBe(201)

    const listRes = await listKeys(token, pharmacyId)
    const summaries = (listRes.body as SuccessBody<readonly SummaryBody[]>).data
    expect(summaries.find((s) => s.id === created.data.id)?.isActive).toBe(false)

    await expect(verification.verify(verifyInputFor(created.data.apiKey, created.data.hmacSecret))).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)

    const auditRows = (await pool.query<AuditLogRow>("SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'revoke'", [created.data.id])).rows
    expect(auditRows).toHaveLength(1)
  })

  it('rotate — идемпотентно по Idempotency-Key (SRS-API-010), старый ключ валиден ДО дедлайна, после — нет (TC-ADM-018/019)', async () => {
    const chainId = await seedChain(`Rotate Chain ${randomUUID().slice(0, 8)}`)
    const pharmacyId = await seedPharmacy(`Rotate Pharmacy ${randomUUID().slice(0, 8)}`, chainId)
    const token = await sign('pharmacy_admin', { chainId })
    const created = (await createKey(token, pharmacyId)).body as SuccessBody<CreatedKeyBody>
    const idempotencyKey = randomUUID()

    const rotate1 = await rotateKey({ token, pharmacyId, keyId: created.data.id, idempotencyKey })
    const rotate2 = await rotateKey({ token, pharmacyId, keyId: created.data.id, idempotencyKey })
    expect(rotate1.status).toBe(201)
    expect((rotate1.body as SuccessBody<CreatedKeyBody>).data).toEqual((rotate2.body as SuccessBody<CreatedKeyBody>).data)

    const totalRows = await pool.query('SELECT id FROM pharmacy_api_keys WHERE pharmacy_id = $1', [pharmacyId])
    expect(totalRows.rows).toHaveLength(2) // старый + один новый (НЕ третья пара — повтор не создал ничего)

    await expect(verification.verify(verifyInputFor(created.data.apiKey, created.data.hmacSecret))).resolves.toMatchObject({ pharmacyId })

    await pool.query('UPDATE pharmacy_api_keys SET rotation_grace_expires_at = now() - interval \'1 hour\' WHERE id = $1', [created.data.id])
    const internalRes = await request(httpServer)
      .post(`/api/v1/internal/pharmacy-api-keys/${created.data.id}/revoke-expired`)
      .set('x-internal-api-key', TEST_INTERNAL_API_KEY)
    expect(internalRes.status).toBe(200)
    expect((internalRes.body as SuccessBody<{ revoked: boolean }>).data.revoked).toBe(true)

    await expect(verification.verify(verifyInputFor(created.data.apiKey, created.data.hmacSecret))).rejects.toBeInstanceOf(PharmacyApiKeyInvalidError)
  })

  it('internal revoke-expired без x-internal-api-key → 401', async () => {
    const res = await request(httpServer).post(`/api/v1/internal/pharmacy-api-keys/${randomUUID()}/revoke-expired`)
    expect(res.status).toBe(401)
  })
})
