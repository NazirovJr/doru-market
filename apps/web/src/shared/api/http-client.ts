import { getClientEnv } from '@/shared/config/env'
import { useAuthStore } from '@/shared/api/auth-store'

/**
 * Тонкая обёртка над fetch — единственный слой, которому разрешено делать сетевые запросы
 * (docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §5: «fetch/axios внутри компонента запрещён — только
 * через слой api»). Компоненты и TanStack Query хуки вызывают `httpRequest`, `httpRequestJson`,
 * а не fetch напрямую.
 *
 * Интерсептор: 401 с кодом `TOKEN_EXPIRED` → refresh ровно один раз → повтор исходного запроса.
 * Повторный 401 после refresh (или неуспешный refresh) → редирект на `/login` (зеркалирует
 * dio-интерцептор мобильных клиентов, SRS-API-035).
 *
 * Persisted refresh: после успешного `POST /auth/refresh` стор обновляется
 * через `setSession` (DTJ-028), в `localStorage` остаётся НОВЫЙ `refreshToken`
 * (ротация, DTJ-025 reuse-detection).
 */

const HTTP_STATUS_UNAUTHORIZED = 401
const TOKEN_EXPIRED_ERROR_CODE = 'TOKEN_EXPIRED'
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'

type HttpClientOptions = RequestInit

interface ApiErrorBody {
  readonly error?: { readonly code?: string }
}

interface RefreshResponseBody {
  readonly data?: {
    readonly accessToken?: string
    readonly refreshToken?: string
    readonly user?: {
      readonly id?: string
      readonly role?: string
      readonly tenantId?: string | null
      readonly phoneNumber?: string | null
      readonly fullName?: string | null
    }
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as ApiErrorBody
    return body.error?.code
  } catch {
    return undefined
  }
}

async function isTokenExpired(response: Response): Promise<boolean> {
  if (response.status !== HTTP_STATUS_UNAUTHORIZED) {
    return false
  }
  return (await readErrorCode(response)) === TOKEN_EXPIRED_ERROR_CODE
}

function buildHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init)
  const accessToken = useAuthStore.getState().accessToken
  if (accessToken !== null) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return headers
}

function performRequest(path: string, init: HttpClientOptions): Promise<Response> {
  const url = `${getClientEnv().apiBaseUrl}${path}`
  // eslint-disable-next-line no-restricted-globals -- этот файл И ЕСТЬ разрешённый слой api (§5).
  return fetch(url, { ...init, headers: buildHeaders(init.headers) })
}

/**
 * `POST /api/v1/auth/refresh` с persisted refreshToken из стора. При успехе
 * обновляет стор (access+refresh+user), иначе очищает (logout).
 */
async function refreshAccessToken(): Promise<boolean> {
  const currentRefresh = useAuthStore.getState().refreshToken
  if (currentRefresh === null) {
    return false
  }
  try {
    // eslint-disable-next-line no-restricted-globals -- см. performRequest.
    const response = await fetch(`${getClientEnv().apiBaseUrl}${AUTH_REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: currentRefresh }),
    })
    if (!response.ok) {
      // 401 REFRESH_TOKEN_INVALID / REFRESH_TOKEN_REUSE_DETECTED → clear.
      useAuthStore.getState().clear()
      return false
    }
    const body = (await response.json()) as RefreshResponseBody
    const accessToken = body.data?.accessToken
    const newRefreshToken = body.data?.refreshToken
    const user = body.data?.user
    if (
      typeof accessToken !== 'string' ||
      typeof newRefreshToken !== 'string' ||
      user === undefined ||
      typeof user.id !== 'string' ||
      typeof user.role !== 'string'
    ) {
      return false
    }
    useAuthStore.getState().setSession({
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        role: user.role,
        tenantId: user.tenantId ?? null,
        phoneNumber: user.phoneNumber ?? null,
        fullName: user.fullName ?? null,
      },
    })
    return true
  } catch {
    return false
  }
}

function redirectToLogin(): void {
  // TODO(DTJ-028.5+): router.navigate('/login?intent=...')
  // eslint-disable-next-line no-console -- временная заглушка редиректа.
  console.warn('[http-client] сессия истекла и не восстановлена — нужен редирект на /login')
  // Best-effort: чистим стор, чтобы UI показал «войдите снова» на /profile.
  useAuthStore.getState().clear()
}

export async function httpRequest(path: string, init: HttpClientOptions = {}): Promise<Response> {
  const firstResponse = await performRequest(path, init)
  if (!(await isTokenExpired(firstResponse))) {
    return firstResponse
  }

  const refreshed = await refreshAccessToken()
  if (!refreshed) {
    redirectToLogin()
    return firstResponse
  }

  const secondResponse = await performRequest(path, init)
  if (secondResponse.status === HTTP_STATUS_UNAUTHORIZED) {
    redirectToLogin()
  }
  return secondResponse
}

/**
 * JSON-вариант: парсит ответ как `unknown`, проверяет `envelope` shape
 * (`{ data, error }`, см. DTJ-005) и возвращает либо `data` (успех), либо
 * бросает `HttpError` (с кодом ошибки для маппинга в login-flow.model).
 *
 * `httpRequest` остаётся доступным для нестандартных путей (например,
 * `text/event-stream` для SSE, DTJ-049).
 */
export class HttpError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

interface SuccessEnvelope<T> {
  readonly data: T
}
interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: unknown }
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return 'data' in value
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const err = (value as { error?: unknown }).error
  if (typeof err !== 'object' || err === null) {
    return false
  }
  return typeof (err as { code?: unknown }).code === 'string'
}

export async function httpRequestJson<T>(
  path: string,
  init: HttpClientOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await httpRequest(path, { ...init, headers })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    throw new HttpError(response.status, 'INVALID_RESPONSE', `Invalid JSON from ${path}`)
  }
  if (response.ok && isSuccessEnvelope<T>(parsed)) {
    return parsed.data
  }
  if (!response.ok && isErrorEnvelope(parsed)) {
    throw new HttpError(response.status, parsed.error.code, parsed.error.message)
  }
  throw new HttpError(
    response.status,
    'UNKNOWN_ERROR',
    `Unexpected response shape from ${path} (status=${response.status})`,
  )
}

/**
 * Удобный helper для POST/JSON (большинство auth-эндпоинтов).
 */
export function httpPostJson<T>(path: string, body: unknown): Promise<T> {
  return httpRequestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
