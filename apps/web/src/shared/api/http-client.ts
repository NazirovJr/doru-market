import { getClientEnv } from '@/shared/config/env'
import { useAuthStore } from '@/shared/api/auth-store'

/**
 * Тонкая обёртка над fetch — единственный слой, которому разрешено делать сетевые запросы
 * (docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §5: «fetch/axios внутри компонента запрещён — только
 * через слой api»). Компоненты и TanStack Query хуки вызывают httpRequest(), а не fetch напрямую.
 *
 * Интерсептор: 401 с кодом TOKEN_EXPIRED → refresh ровно один раз → повтор исходного запроса.
 * Повторный 401 после refresh (или неуспешный refresh) → редирект на /login (зеркалирует
 * dio-интерцептор мобильных клиентов, SRS-API-035).
 */

const HTTP_STATUS_UNAUTHORIZED = 401
const TOKEN_EXPIRED_ERROR_CODE = 'TOKEN_EXPIRED'
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'

type HttpClientOptions = RequestInit

interface ApiErrorBody {
  readonly error?: { readonly code?: string }
}

interface RefreshResponseBody {
  readonly accessToken?: string
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
 * Заглушка до готовности эндпоинта (DTJ-025): вызывается ровно один раз интерсептором ниже,
 * реальная ротация refresh-токена (SRS-API-026) появится вместе с ним.
 */
async function refreshAccessToken(): Promise<boolean> {
  try {
    // eslint-disable-next-line no-restricted-globals -- см. комментарий в performRequest выше.
    const response = await fetch(`${getClientEnv().apiBaseUrl}${AUTH_REFRESH_PATH}`, { method: 'POST' })
    if (!response.ok) {
      return false
    }
    const body = (await response.json()) as RefreshResponseBody
    if (typeof body.accessToken !== 'string') {
      return false
    }
    useAuthStore.getState().setAccessToken(body.accessToken)
    return true
  } catch {
    return false
  }
}

function redirectToLogin(): void {
  // TODO(DTJ-028): заменить на реальный редирект после готовности экрана /login.
  // eslint-disable-next-line no-console -- временная заглушка редиректа, явно предписана тикетом DTJ-003.
  console.warn('[http-client] сессия истекла и не восстановлена — редирект на /login появится в DTJ-028')
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
