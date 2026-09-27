import { getOtpFromMockSms } from './get-otp-from-mock-sms.js'

const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'

export interface ApiSession {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string
    readonly phoneNumber: string
    readonly fullName: string | null
  }
}

export interface LoginViaApiOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  // Тенант White-Label резолвится по Host — сценарии изоляции передают его явно.
  readonly headers?: Readonly<Record<string, string>>
}

export async function loginViaApi(phone: string, options: LoginViaApiOptions = {}): Promise<ApiSession> {
  const baseUrl = options.baseUrl ?? process.env.E2E_BASE_URL ?? DEFAULT_TEST_API_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { 'content-type': 'application/json', ...options.headers }

  const post = <T>(path: string, body: unknown): Promise<T> =>
    postJson<T>(fetchImpl, { url: `${baseUrl}${path}`, headers, body })

  const requested = await post<{ otpRequestId: string }>('/api/v1/auth/otp/request', { phone })
  const code = await getOtpFromMockSms(phone, { baseUrl, fetchImpl })
  return post<ApiSession>('/api/v1/auth/otp/verify', { otpRequestId: requested.otpRequestId, code })
}

interface PostJsonRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

async function postJson<T>(fetchImpl: typeof fetch, { url, headers, body }: PostJsonRequest): Promise<T> {
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) {
    throw new Error(`loginViaApi: POST ${url} вернул ${String(response.status)}: ${await response.text()}`)
  }
  return ((await response.json()) as { data: T }).data
}
