import { useAuthStore, type AuthUser } from '@/shared/api/auth-store'

/**
 * `http-client.ts` (DTJ-166) — тонкая обёртка над fetch, единственный слой, которому разрешено
 * делать сетевые запросы (`docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` §5: «fetch/axios внутри
 * компонента запрещён — только через слой api»). Портировано из
 * `apps/web/src/shared/api/http-client.ts` (EP-01, DTJ-028) — ТОТ ЖЕ контракт `/auth/otp/*` и
 * `/auth/refresh` (DTJ-166 «Технический контекст»). TODO(EP-18): вынести в общий пакет, когда
 * появится shared http-слой для всех фронтендов (см. DTJ-166 «Риски»).
 *
 * Интерсептор: 401 с кодом `TOKEN_EXPIRED` → `POST /auth/refresh` РОВНО ОДИН РАЗ → повтор
 * исходного запроса. Повторный `401` после рефреша (или неуспешный рефреш) → редирект на
 * `/login`, БЕЗ повторного рефреша — защита от бесконечного цикла (критерий приёмки 3 DTJ-166,
 * веб-эквивалент dio-интерцептора мобильных клиентов, `SRS-API-035`).
 *
 * Отличие от `apps/web`: там редирект на `/login` — заглушка (`TODO(DTJ-028.5+)`, только
 * `console.warn` + очистка стора). Здесь редирект РЕАЛЬНЫЙ (критерий приёмки 3 требует именно
 * редирект, не заглушку) — через `window.location.assign`, а не `router.navigate(...)`:
 * `shared/api` не имеет права импортировать `app/router` (правило `fe-shared-is-lowest`,
 * `.dependency-cruiser.cjs` §5) — жёсткая навигация браузера остаётся единственным способом
 * инициировать переход отсюда, не нарушая направление зависимостей фронтенда.
 *
 * `VITE_API_BASE_URL` — безопасный дефолт `http://localhost:3000` вместо fail-fast `apps/web`
 * (см. `vite.config.ts`, комментарий про паттерн `apps/admin`).
 */

const HTTP_STATUS_UNAUTHORIZED = 401
const TOKEN_EXPIRED_ERROR_CODE = 'TOKEN_EXPIRED'
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'
const LOGIN_PATH = '/login'
const DEFAULT_API_BASE_URL = 'http://localhost:3000'

interface ClientEnv {
  readonly apiBaseUrl: string
}

function getClientEnv(): ClientEnv {
  const raw: unknown = import.meta.env.VITE_API_BASE_URL
  return { apiBaseUrl: typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_API_BASE_URL }
}

type HttpClientOptions = RequestInit

interface ApiErrorBody {
  readonly error?: { readonly code?: string }
}

interface RefreshResponseUser {
  readonly id?: string
  readonly role?: string
  readonly tenantId?: string | null
  readonly phoneNumber?: string | null
  readonly fullName?: string | null
}

interface RefreshResponsePayload {
  readonly accessToken?: string
  readonly refreshToken?: string
  readonly user?: RefreshResponseUser
}

/** Продовый бэкенд оборачивает payload в envelope `{ data: {...} }` — упрощённые эндпоинты могут
 * вернуть тот же payload плоским; поддерживаем обе формы (см. apps/web, тот же комментарий). */
type RefreshResponseBody = RefreshResponsePayload & { readonly data?: RefreshResponsePayload }

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

interface ParsedRefreshPayload {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly user: AuthUser | null
}

function parseRefreshUser(user: RefreshResponseUser | undefined): AuthUser | null {
  if (user === undefined || typeof user.id !== 'string' || typeof user.role !== 'string') {
    return null
  }
  return {
    id: user.id,
    role: user.role,
    tenantId: user.tenantId ?? null,
    phoneNumber: user.phoneNumber ?? null,
    fullName: user.fullName ?? null,
  }
}

function parseRefreshPayload(
  body: RefreshResponseBody,
  currentRefresh: string | null,
): ParsedRefreshPayload | null {
  const payload = body.data ?? body
  if (typeof payload.accessToken !== 'string') {
    return null
  }
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? currentRefresh,
    user: parseRefreshUser(payload.user),
  }
}

function applyRefreshResult(parsed: ParsedRefreshPayload): void {
  const resolvedUser = parsed.user ?? useAuthStore.getState().user
  if (resolvedUser !== null && parsed.refreshToken !== null) {
    useAuthStore.getState().setSession({
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      user: resolvedUser,
    })
  } else {
    // Минимальный ответ (нет refresh-токена и/или user) — обновляем только access-токен.
    useAuthStore.getState().setAccessToken(parsed.accessToken)
  }
}

/** `POST /api/v1/auth/refresh` с persisted refreshToken из стора. */
async function refreshAccessToken(): Promise<boolean> {
  const currentRefresh = useAuthStore.getState().refreshToken
  try {
    // eslint-disable-next-line no-restricted-globals -- см. performRequest.
    const response = await fetch(`${getClientEnv().apiBaseUrl}${AUTH_REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: currentRefresh }),
    })
    if (!response.ok) {
      useAuthStore.getState().clear()
      return false
    }
    const body = (await response.json()) as RefreshResponseBody
    const parsed = parseRefreshPayload(body, currentRefresh)
    if (parsed === null) {
      return false
    }
    applyRefreshResult(parsed)
    return true
  } catch {
    return false
  }
}

/** Реальный редирект (критерий приёмки 3) — очищаем стор, чтобы AuthGuard не увидел протухшую
 * сессию, и уводим браузер на /login жёсткой навигацией (см. JSDoc файла). */
function redirectToLogin(): void {
  useAuthStore.getState().clear()
  window.location.assign(LOGIN_PATH)
}

/** Дедупликация параллельных refresh'ей: несколько 401 TOKEN_EXPIRED одновременно ждут ОДИН
 * общий `POST /auth/refresh`, а не гонку ротации refresh-токена. */
let inFlightRefresh: Promise<boolean> | null = null

function refreshAccessTokenOnce(): Promise<boolean> {
  inFlightRefresh ??= refreshAccessToken().finally(() => {
    inFlightRefresh = null
  })
  return inFlightRefresh
}

async function requestWithAuthRetry(
  path: string,
  init: HttpClientOptions,
  alreadyRetried: boolean,
): Promise<Response> {
  const response = await performRequest(path, init)
  if (!(await isTokenExpired(response))) {
    return response
  }
  // Второй 401 TOKEN_EXPIRED подряд (уже после одного refresh+повтора) — редирект БЕЗ повторного
  // рефреша, иначе неуспешный рефреш уводит клиент в бесконечный цикл.
  if (alreadyRetried) {
    redirectToLogin()
    return response
  }

  const refreshed = await refreshAccessTokenOnce()
  if (!refreshed) {
    redirectToLogin()
    return response
  }

  return requestWithAuthRetry(path, init, true)
}

export function httpRequest(path: string, init: HttpClientOptions = {}): Promise<Response> {
  return requestWithAuthRetry(path, init, false)
}

/**
 * `HttpError` — код ошибки для маппинга в `login-flow.model.errorCodeToI18nKey`.
 * `details` — опциональная программно-читаемая часть ошибки (см. apps/web, тот же контракт).
 */
export class HttpError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details: unknown

  constructor(
    status: number,
    code: string,
    options?: { readonly message?: string | undefined; readonly details?: unknown },
  ) {
    super(options?.message ?? code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = options?.details
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

function parseResponseBody(text: string, path: string, status: number): unknown {
  if (text.length === 0) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(status, 'INVALID_RESPONSE', { message: `Invalid JSON from ${path}` })
  }
}

/**
 * Парсит `envelope` (`{ data }` / `{ error }`, `SRS-API-026`), бросает `HttpError` на неуспех.
 * `HttpError.status` — реальный `response.status` (не выведенный из тела) — единственный
 * надёжный сигнал для 5xx-деградации (тот же приём, что `apps/web`, `SRS-CAT-075`).
 */
export async function httpRequestJson<T>(path: string, init: HttpClientOptions = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await httpRequest(path, { ...init, headers })
  const text = await response.text()
  const parsed = parseResponseBody(text, path, response.status)
  if (response.ok && isSuccessEnvelope<T>(parsed)) {
    return parsed.data
  }
  if (!response.ok && isErrorEnvelope(parsed)) {
    throw new HttpError(response.status, parsed.error.code, {
      message: parsed.error.message,
      details: parsed.error.details,
    })
  }
  throw new HttpError(response.status, 'UNKNOWN_ERROR', {
    message: `Unexpected response shape from ${path} (status=${String(response.status)})`,
  })
}

/** Удобный helper для POST/JSON (auth-эндпоинты: `otp/request`, `otp/verify`). */
export function httpPostJson<T>(path: string, body: unknown): Promise<T> {
  return httpRequestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
