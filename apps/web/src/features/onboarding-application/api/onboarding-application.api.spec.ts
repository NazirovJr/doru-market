import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { HttpError } from '@/shared/api/http-client'
import {
  requestContactPhoneOtp,
  submitChainApplication,
  submitChainForReview,
  submitPharmacyApplication,
  submitPharmacyForReview,
  uploadOnboardingDocument,
  verifyContactPhone,
} from './onboarding-application.api'

/**
 * `onboarding-application.api.spec.ts` (DTJ-076) — сетевой контракт с реальными путями
 * `pharmacy-chains-public.controller.ts`/`pharmacy-accounts-public.controller.ts`/
 * `onboarding-documents.controller.ts` (все прочитаны целиком).
 */

const BASE_URL = getClientEnv().apiBaseUrl
const CHAIN_ID = '11111111-1111-4111-8111-111111111111'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('onboarding-application.api (DTJ-076)', () => {
  it('1. submitChainApplication — POST /api/v1/pharmacy-chains с телом запроса', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: CHAIN_ID, status: 'draft' } }), { status: 201 })),
    )
    const result = await submitChainApplication({
      legalEntityName: 'Фарм Сервис',
      tinInn: '123456789',
      directorFullName: 'Иванов Иван',
      contactPhone: '+992901234567',
      legalAddress: null,
      isWhitelabelRequested: false,
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/pharmacy-chains`)
    expect(init?.method).toBe('POST')
    expect(result).toEqual({ id: CHAIN_ID, status: 'draft' })
  })

  it('2. requestContactPhoneOtp — POST /api/v1/pharmacy-chains/:id/request-contact-phone-otp', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { sent: true } }), { status: 200 })),
    )
    await requestContactPhoneOtp(CHAIN_ID)
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/pharmacy-chains/${CHAIN_ID}/request-contact-phone-otp`)
  })

  it('3. verifyContactPhone(НЕВЕРНЫЙ код) — HttpError с кодом OTP_MISMATCH (AC4)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'OTP_MISMATCH', message: 'x' } }), { status: 400 }),
      ),
    )
    const error: unknown = await verifyContactPhone(CHAIN_ID, '000000').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe('OTP_MISMATCH')
  })

  it('4. submitChainForReview — POST /api/v1/pharmacy-chains/:id/submit', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: CHAIN_ID, status: 'pending_review' } }), { status: 200 })),
    )
    const result = await submitChainForReview(CHAIN_ID)
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/pharmacy-chains/${CHAIN_ID}/submit`)
    expect(result.status).toBe('pending_review')
  })

  it('5. submitPharmacyApplication — POST /api/v1/pharmacy-accounts, возвращает chainId', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: 'acc-1', chainId: CHAIN_ID, status: 'draft' } }), { status: 201 }),
      ),
    )
    const result = await submitPharmacyApplication({
      chainId: CHAIN_ID,
      name: 'Аптека на Рудаки',
      addressText: 'ул. Рудаки, 12',
      latitude: 38.5598,
      longitude: 68.787,
      phone: '+992901234567',
      isOpen247: false,
      licenseNumber: 'LIC-1',
      licenseExpiryDate: '2030-01-01',
      pharmacistInChargeName: 'Каримова Зарина',
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/pharmacy-accounts`)
    expect(result).toEqual({ id: 'acc-1', chainId: CHAIN_ID, status: 'draft' })
  })

  it('6. submitPharmacyForReview — POST /api/v1/pharmacy-accounts/:id/submit', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: 'acc-1', status: 'pending_review' } }), { status: 200 })),
    )
    await submitPharmacyForReview('acc-1')
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/pharmacy-accounts/acc-1/submit`)
  })

  it('7. uploadOnboardingDocument — POST /api/v1/onboarding-documents с JSON base64-телом (не multipart)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { url: 'https://cdn.example/x.pdf' } }), { status: 201 })),
    )
    const result = await uploadOnboardingDocument({ base64: 'AAAA', mimeType: 'application/pdf', fileName: 'license.pdf' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE_URL}/api/v1/onboarding-documents`)
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init?.body as string)).toEqual({ base64: 'AAAA', mimeType: 'application/pdf', fileName: 'license.pdf' })
    expect(result.url).toBe('https://cdn.example/x.pdf')
  })

  it('8. 409 CHAIN_APPLICATION_ALREADY_EXISTS (SRS-ADM-007) — HttpError с этим кодом, не проглатывается', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'CHAIN_APPLICATION_ALREADY_EXISTS', message: 'x' } }),
          { status: 409 },
        ),
      ),
    )
    const error: unknown = await submitChainApplication({
      legalEntityName: 'Фарм Сервис',
      tinInn: '123456789',
      directorFullName: 'Иванов Иван',
      contactPhone: '+992901234567',
      legalAddress: null,
      isWhitelabelRequested: false,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe('CHAIN_APPLICATION_ALREADY_EXISTS')
  })
})
