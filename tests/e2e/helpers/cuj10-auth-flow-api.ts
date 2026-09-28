/**
 * CUJ-10 (DTJ-421, `SRS-NFR-074`) — тонкие HTTP-обёртки поверх `refresh`/`sessions`/`audit-log`.
 * Тот же стиль `{status, body}` без throw на `!ok`, что `cuj9-onboarding-api.ts` — негативные
 * коды ошибок (`401`/`403`) читаются из тела ответа, не только по статусу.
 */
const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'

export interface HttpOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

export interface RawResponse<T> {
  readonly status: number
  readonly body: T
}

interface ErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string }
}

function resolveBaseUrl(options: HttpOptions): string {
  return options.baseUrl ?? process.env.E2E_BASE_URL ?? DEFAULT_TEST_API_BASE_URL
}

async function call<T>(
  method: 'GET' | 'POST',
  urlPath: string,
  options: HttpOptions & { readonly token?: string; readonly body?: unknown },
): Promise<RawResponse<T>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`
  }
  const response = await fetchImpl(`${resolveBaseUrl(options)}${urlPath}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  const parsed = text.length === 0 ? undefined : (JSON.parse(text) as T)
  return { status: response.status, body: parsed as T }
}

export interface RefreshResponseData {
  readonly accessToken: string
  readonly refreshToken: string
}

/** `POST /api/v1/auth/refresh` — `@Public()`, аутентификация самим refresh-токеном. */
export function refreshTokens(
  refreshToken: string,
  options: HttpOptions = {},
): Promise<RawResponse<{ readonly data?: RefreshResponseData } & ErrorBody>> {
  return call('POST', '/api/v1/auth/refresh', { ...options, body: { refreshToken } })
}

export interface SessionListItem {
  readonly id: string
}

/** `GET /api/v1/auth/sessions` — self-service, любая аутентифицированная роль (`AuthGuard` без `RolesGuard`). */
export function getOwnSessions(
  accessToken: string,
  options: HttpOptions = {},
): Promise<RawResponse<{ readonly data?: readonly SessionListItem[] } & ErrorBody>> {
  return call('GET', '/api/v1/auth/sessions', { ...options, token: accessToken })
}

/** `GET /api/v1/audit-log` — `@Roles('super_admin')`. */
export function getAuditLog(accessToken: string, options: HttpOptions = {}): Promise<RawResponse<ErrorBody>> {
  return call('GET', '/api/v1/audit-log', { ...options, token: accessToken })
}
