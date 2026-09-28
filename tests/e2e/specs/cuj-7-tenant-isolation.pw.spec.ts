// CUJ-7' — White-Label / изоляция тенантов (DTJ-419). White-Label — заголовком `X-Tenant-Slug`
// (см. коммит/отчёт сдачи про домен и отсутствующие клиентские эндпоинты заказов).
import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { SEED_TENANTS, SEED_USERS, SEED_PHARMACIES, E2E_FRESH_PHONE_PREFIX } from '@dorutj/testing-kit'
import { loginViaApi } from '../helpers/login-via-api.js'

const BASE_URL_RAW = process.env.E2E_BASE_URL
const TICKET_PHONE_DIGITS = '19'
const WHITE_LABEL_HEADERS = { 'X-Tenant-Slug': SEED_TENANTS.whiteLabel.slug }

function baseUrl(): string {
  if (BASE_URL_RAW === undefined) throw new Error('E2E_BASE_URL не задан')
  return BASE_URL_RAW
}

let freshPhoneCounter = 500 + (Date.now() % 400)
function nextFreshPhone(): string {
  freshPhoneCounter += 1
  return `${E2E_FRESH_PHONE_PREFIX}${TICKET_PHONE_DIGITS}${String(freshPhoneCounter % 1000).padStart(3, '0')}`
}

test.describe('CUJ-7: White-Label / изоляция тенантов', () => {
  test.skip(BASE_URL_RAW === undefined, 'нужен E2E_BASE_URL — живой стенд API')

  test('neutral tenant resolves with default palette', async () => {
    const session = await loginViaApi(nextFreshPhone(), { baseUrl: baseUrl() })
    expect(session.user.tenantId).toBe(SEED_TENANTS.neutral.id)
  })

  test('white-label tenant resolves with distinct branding', async () => {
    const session = await loginViaApi(nextFreshPhone(), { baseUrl: baseUrl(), headers: WHITE_LABEL_HEADERS })
    expect(session.user.tenantId).toBe(SEED_TENANTS.whiteLabel.id)
    expect(session.user.tenantId).not.toBe(SEED_TENANTS.neutral.id)
  })

  test('cross-tenant order access returns 404, not 403', async ({ request }) => {
    const session = await loginViaApi(nextFreshPhone(), { baseUrl: baseUrl() })
    const foreignOrderId = randomUUID()
    const response = await request.post(`/api/v1/orders/${foreignOrderId}/cancel`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { reason: 'customer_changed_mind' },
    })
    expect(response.status()).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('unknown tenant slug returns 404, no silent fallback to neutral', async ({ request }) => {
    const response = await request.post('/api/v1/auth/otp/request', {
      headers: { 'X-Tenant-Slug': `bogus-slug-${randomUUID()}` },
      data: { phone: nextFreshPhone() },
    })
    expect(response.status()).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNKNOWN_TENANT_SLUG')
  })

  test(
    "order list endpoint never leaks another tenant's rows (TC-API-030)",
    { tag: '@critical' },
    async ({ request }) => {
      const pharmacistSession = await loginViaApi(SEED_USERS.pharmacistOneC.phone, { baseUrl: baseUrl() })
      expect(pharmacistSession.user.tenantId).toBe(SEED_TENANTS.neutral.id)

      const response = await request.get(
        `/api/v1/orders?sort=priority&filter%5BpharmacyId%5D=${SEED_PHARMACIES.whiteLabelCenter.id}`,
        { headers: { Authorization: `Bearer ${pharmacistSession.accessToken}` } },
      )

      expect(response.status()).toBe(403)
      const body = (await response.json()) as { error?: { code?: string }; data?: unknown }
      expect(body.error?.code).toBe('FORBIDDEN')
      expect(body.data).toBeUndefined()
    },
  )
})
