// Supertest-интеграция контроллеров онбординга против реальных Postgres/Redis: все маршруты с :id и телом.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/onboarding-test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const LICENSE_PDF_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../tests/fixtures/onboarding/license-valid.pdf')
const HTTP_UNAUTHORIZED = 401
const HTTP_OK = 200
const HTTP_REDIRECT_MIN = 300
const FULL_CHECKLIST = {
  inn_matches_documents: true,
  license_is_valid: true,
  address_matches_license: true,
  contact_phone_verified: true,
}

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

interface DataBody<T> {
  readonly data: T
}
interface ErrorBody {
  readonly error: { readonly code: string }
}
interface StatusBody {
  readonly id: string
  readonly status: string
}
interface DetailBody {
  readonly id: string
  readonly name: string
  readonly licenseNumber: string
  readonly pharmacistInChargeName: string | null
  readonly licenseScan: { readonly url: string; readonly contentType: string } | null
}

describe.skipIf(!postgresAvailable)('Контроллеры онбординга — Supertest integration (DTJ-442)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let superAdminToken: string
  let pharmacyAdminToken: string
  const chainIds: string[] = []

  function sign(role: 'super_admin' | 'pharmacy_admin'): string {
    const signer = app.get<JwtSignerPort>(JWT_SIGNER)
    return signer.sign({ sub: randomUUID(), role, tenantId: null, pharmacyId: null, chainId: null, sessionId: randomUUID() })
  }

  async function seedChain(status: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, contact_phone)
       VALUES ($1, 'DTJ-442 chain', 'DTJ-442 LLC', $2, $3, '+992900000442')`,
      [id, randomUUID().replaceAll('-', '').slice(0, 15), status],
    )
    chainIds.push(id)
    return id
  }

  async function createApplication(chainId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const response = await request(httpServer)
      .post('/api/v1/pharmacy-accounts')
      .send({
        chainId,
        name: 'DTJ-442 pharmacy',
        addressText: 'Dushanbe, Test st. 1',
        latitude: 38.5598,
        longitude: 68.787,
        phone: '+992900000442',
        isOpen247: true,
        licenseNumber: `DTJ442-${randomUUID().slice(0, 8)}`,
        licenseExpiryDate: '2030-01-01',
        pharmacistInChargeName: 'Tester T.',
        ...extra,
      })
    expect(response.status).toBeLessThan(HTTP_REDIRECT_MIN)
    return (response.body as DataBody<StatusBody>).data.id
  }

  async function createPendingApplication(chainId: string): Promise<string> {
    const id = await createApplication(chainId)
    const submit = await request(httpServer).post(`/api/v1/pharmacy-accounts/${id}/submit`).send({})
    expect(submit.status).toBe(HTTP_OK)
    return id
  }

  function decide(id: string, action: string, body: Record<string, unknown>): request.Test {
    return request(httpServer)
      .post(`/api/v1/admin/verifications/pharmacy-accounts/${id}/${action}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send(body)
  }

  async function dbStatus(id: string): Promise<string | undefined> {
    const result = await pool.query<{ status: string }>('SELECT status FROM pharmacies WHERE id = $1', [id])
    return result.rows[0]?.status
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    superAdminToken = sign('super_admin')
    pharmacyAdminToken = sign('pharmacy_admin')
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (chainIds.length > 0) {
        await pool.query('DELETE FROM pharmacies WHERE chain_id = ANY($1)', [chainIds])
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [chainIds])
      }
      await pool.end()
    }
  })

  describe('POST /pharmacy-accounts/:id/submit', () => {
    it('переводит draft в pending_review', async () => {
      const chainId = await seedChain('active')
      const id = await createApplication(chainId)
      const response = await request(httpServer).post(`/api/v1/pharmacy-accounts/${id}/submit`).send({})
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('pending_review')
      expect(await dbStatus(id)).toBe('pending_review')
    })

    it('отклоняет непустое тело как VALIDATION_ERROR', async () => {
      const id = await createApplication(await seedChain('active'))
      const response = await request(httpServer).post(`/api/v1/pharmacy-accounts/${id}/submit`).send({ extra: 1 })
      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('отклоняет не-UUID в :id', async () => {
      const response = await request(httpServer).post('/api/v1/pharmacy-accounts/not-a-uuid/submit').send({})
      expect(response.status).toBe(400)
    })

    it('повторная подача не из draft — конфликт', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await request(httpServer).post(`/api/v1/pharmacy-accounts/${id}/submit`).send({})
      expect(response.status).toBe(409)
    })
  })

  describe('POST /pharmacy-chains/:id/…', () => {
    it('submit переводит сеть в pending_review', async () => {
      const chainId = await seedChain('draft')
      const response = await request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/submit`).send({})
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('pending_review')
    })

    it('verify-contact-phone валидирует тело, а не :id', async () => {
      const chainId = await seedChain('draft')
      const response = await request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/verify-contact-phone`).send({})
      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('request-contact-phone-otp принимает пустое тело', async () => {
      const chainId = await seedChain('draft')
      const response = await request(httpServer).post(`/api/v1/pharmacy-chains/${chainId}/request-contact-phone-otp`).send({})
      expect(response.status).toBe(HTTP_OK)
    })
  })

  describe('approve', () => {
    it('активирует аптеку при активной сети', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'approve', { checklist: FULL_CHECKLIST })
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('active')
      expect(await dbStatus(id)).toBe('active')
      const log = await pool.query('SELECT 1 FROM onboarding_review_log WHERE pharmacy_id = $1 AND action = $2', [id, 'approve'])
      expect(log.rowCount).toBe(1)
    })

    it('оставляет approved, пока сеть не одобрена (инвариант родительской сети)', async () => {
      const id = await createPendingApplication(await seedChain('pending_review'))
      const response = await decide(id, 'approve', { checklist: FULL_CHECKLIST })
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('approved')
      expect(await dbStatus(id)).toBe('approved')
    })

    it('без checklist — VALIDATION_ERROR', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'approve', {})
      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
      expect(await dbStatus(id)).toBe('pending_review')
    })

    it('роль не super_admin — 403 INSUFFICIENT_ROLE', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await request(httpServer)
        .post(`/api/v1/admin/verifications/pharmacy-accounts/${id}/approve`)
        .set('Authorization', `Bearer ${pharmacyAdminToken}`)
        .send({ checklist: FULL_CHECKLIST })
      expect(response.status).toBe(403)
      expect((response.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    })

    it('без токена — 401', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await request(httpServer)
        .post(`/api/v1/admin/verifications/pharmacy-accounts/${id}/approve`)
        .send({ checklist: FULL_CHECKLIST })
      expect(response.status).toBe(HTTP_UNAUTHORIZED)
    })

    it('заявка в draft одобрена быть не может', async () => {
      const id = await createApplication(await seedChain('active'))
      const response = await decide(id, 'approve', { checklist: FULL_CHECKLIST })
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await dbStatus(id)).toBe('draft')
    })
  })

  describe('reject / request-changes / terminate', () => {
    it('reject с причиной — rejected', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'reject', { reason: 'license is not valid' })
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('rejected')
      expect(await dbStatus(id)).toBe('rejected')
    })

    it('reject без причины — VALIDATION_ERROR', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'reject', {})
      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('request-changes — changes_requested', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'request-changes', { reason: 'attach a clearer scan' })
      expect(response.status).toBe(HTTP_OK)
      expect(await dbStatus(id)).toBe('changes_requested')
    })

    it('terminate — terminated', async () => {
      const id = await createPendingApplication(await seedChain('active'))
      const response = await decide(id, 'terminate', { reason: 'fraud' })
      expect(response.status).toBe(HTTP_OK)
      expect(await dbStatus(id)).toBe('terminated')
    })

    it('решения по сети принимают :id и тело', async () => {
      const chainId = await seedChain('pending_review')
      const response = await request(httpServer)
        .post(`/api/v1/admin/verifications/pharmacy-chains/${chainId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'incomplete documents' })
      expect(response.status).toBe(HTTP_OK)
      expect((response.body as DataBody<StatusBody>).data.status).toBe('rejected')
    })
  })

  describe('suspend / force-cancel / reactivation / revoke', () => {
    async function createActive(): Promise<string> {
      const id = await createPendingApplication(await seedChain('active'))
      await decide(id, 'approve', { checklist: FULL_CHECKLIST })
      return id
    }

    it('suspend → request-reactivation', async () => {
      const id = await createActive()
      const suspend = await request(httpServer)
        .post(`/api/v1/admin/pharmacy-accounts/${id}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'license_expired' })
      expect(suspend.status).toBe(HTTP_OK)
      expect(await dbStatus(id)).toBe('suspended')
      const reactivation = await request(httpServer).post(`/api/v1/pharmacy-accounts/${id}/request-reactivation`).send({})
      expect(reactivation.status).toBe(HTTP_OK)
      expect(await dbStatus(id)).toBe('pending_review')
    })

    it('suspend с неизвестной причиной — VALIDATION_ERROR', async () => {
      const id = await createActive()
      const response = await request(httpServer)
        .post(`/api/v1/admin/pharmacy-accounts/${id}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'because' })
      expect(response.status).toBe(400)
      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    })

    it('force-cancel-incomplete-orders требует Idempotency-Key и принимает тело', async () => {
      const id = await createActive()
      await request(httpServer)
        .post(`/api/v1/admin/pharmacy-accounts/${id}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'license_revoked' })
      const response = await request(httpServer)
        .post(`/api/v1/admin/pharmacy-accounts/${id}/force-cancel-incomplete-orders`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'license revoked' })
      expect(response.status).toBe(HTTP_OK)
    })

    it('revoke принимает :id верификации и тело', async () => {
      const id = await createActive()
      const verification = await pool.query<{ id: string }>(
        `SELECT id FROM pharmacy_verification WHERE pharmacy_id = $1 AND verification_status = 'verified' LIMIT 1`,
        [id],
      )
      const verificationId = verification.rows[0]?.id
      expect(verificationId).toBeDefined()
      const response = await request(httpServer)
        .post(`/api/v1/pharmacy-verifications/${String(verificationId)}/revoke`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'approved by mistake' })
      expect(response.status).toBe(HTTP_OK)
      expect(await dbStatus(id)).toBe('suspended')
    })
  })

  describe('GET /admin/verifications/pharmacy-accounts/:id и скан лицензии', () => {
    async function uploadLicense(): Promise<string> {
      const response = await request(httpServer)
        .post('/api/v1/onboarding-documents')
        .send({ base64: readFileSync(LICENSE_PDF_PATH).toString('base64'), mimeType: 'application/pdf', fileName: 'license.pdf' })
      expect(response.status).toBeLessThan(HTTP_REDIRECT_MIN)
      return (response.body as DataBody<{ url: string }>).data.url
    }

    function getDetail(id: string, token = superAdminToken): request.Test {
      return request(httpServer).get(`/api/v1/admin/verifications/pharmacy-accounts/${id}`).set('Authorization', `Bearer ${token}`)
    }

    it('отдаёт заявку и временную ссылку, по которой скачивается загруженный файл', async () => {
      const licenseScanUrl = await uploadLicense()
      const id = await createApplication(await seedChain('active'), { licenseScanUrl })
      const detail = await getDetail(id)
      expect(detail.status).toBe(200)
      const body = (detail.body as DataBody<DetailBody>).data
      expect(body.pharmacistInChargeName).toBe('Tester T.')
      expect(body.licenseScan?.contentType).toBe('application/pdf')
      const file = await request(httpServer).get(body.licenseScan?.url ?? '').buffer(true).parse(binaryParser)
      expect(file.status).toBe(200)
      expect(file.headers['content-type']).toContain('application/pdf')
      expect((file.body as Buffer).equals(readFileSync(LICENSE_PDF_PATH))).toBe(true)
    })

    it('ссылка с подделанной подписью или чужим ключом не открывается', async () => {
      const licenseScanUrl = await uploadLicense()
      const id = await createApplication(await seedChain('active'), { licenseScanUrl })
      const link = ((await getDetail(id)).body as DataBody<DetailBody>).data.licenseScan?.url ?? ''
      const tampered = link.replace(/signature=[0-9a-f]/u, 'signature=0')
      expect((await request(httpServer).get(tampered)).status).toBe(404)
      const expired = link.replace(/expires=\d+/u, 'expires=1')
      expect((await request(httpServer).get(expired)).status).toBe(404)
      const traversal = await request(httpServer).get('/api/v1/onboarding-documents/files/..%2F..%2Fetc%2Fpasswd?expires=9999999999&signature=00')
      expect(traversal.status).toBe(404)
    })

    it('чужой file:// URL из заявки ссылкой не становится', async () => {
      const id = await createApplication(await seedChain('active'), { licenseScanUrl: 'file:///etc/passwd' })
      const detail = await getDetail(id)
      expect(detail.status).toBe(200)
      expect((detail.body as DataBody<DetailBody>).data.licenseScan).toBeNull()
    })

    it('без скана licenseScan = null; неизвестная заявка — 404; не super_admin — 403', async () => {
      const id = await createApplication(await seedChain('active'))
      expect(((await getDetail(id)).body as DataBody<DetailBody>).data.licenseScan).toBeNull()
      expect((await getDetail(randomUUID())).status).toBe(404)
      expect((await getDetail(id, pharmacyAdminToken)).status).toBe(403)
    })
  })
})

function binaryParser(res: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => {
    callback(null, Buffer.concat(chunks))
  })
}
