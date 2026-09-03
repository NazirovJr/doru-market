import { getClientEnv } from '@/shared/config/env'
import { type AuthUser, useAuthStore } from '@/shared/api/auth-store'

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

/**
 * Продовый бэкенд оборачивает payload в envelope `{ data: {...} }` (SRS-API-026,
 * `RefreshController`). Часть упрощённых/smoke-эндпоинтов может вернуть тот же
 * payload плоским, без `data` — поддерживаем обе формы.
 */
type RefreshResponseBody = RefreshResponsePayload & {
  readonly data?: RefreshResponsePayload
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

/**
 * [Task 8, handoff §9] Продовый бэкенд всегда возвращает `refreshToken` (ротация,
 * SRS-API-035, DTJ-025 reuse-detection) и `user`. Часть упрощённых/smoke-эндпоинтов может
 * вернуть только `accessToken` — тогда переиспользуем старый refresh-токен и старого `user`.
 */
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
    // Минимальный ответ (нет refresh-токена и/или user ни в ответе, ни сохранённых) —
    // обновляем только access-токен, остального сохранять не из чего.
    useAuthStore.getState().setAccessToken(parsed.accessToken)
  }
}

/**
 * `POST /api/v1/auth/refresh` с persisted refreshToken из стора. При успехе
 * обновляет стор (access+refresh+user), иначе очищает (logout).
 */
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
      // 401 REFRESH_TOKEN_INVALID / REFRESH_TOKEN_REUSE_DETECTED → clear.
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

function redirectToLogin(): void {
  // TODO(DTJ-028.5+): router.navigate('/login?intent=...')
  // eslint-disable-next-line no-console -- временная заглушка редиректа.
  console.warn('[http-client] сессия истекла и не восстановлена — нужен редирект на /login')
  // Best-effort: чистим стор, чтобы UI показал «войдите снова» на /profile.
  useAuthStore.getState().clear()
}

/**
 * Дедупликация параллельных refresh'ей: несколько запросов, упавших в 401 TOKEN_EXPIRED
 * одновременно, обязаны дождаться ОДНОГО общего `POST /auth/refresh`, а не выстрелить
 * refresh'ем каждый за себя (гонка ротации refresh-токена, DTJ-025 reuse-detection).
 */
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
  // Второй 401 TOKEN_EXPIRED подряд (уже после одного refresh+повтора) наверх, без
  // повторного refresh'а — иначе неуспешный refresh уводит клиент в бесконечный цикл.
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
  // `details` — программно-читаемая часть ошибки (например, `{ field: 'bbox' }` для
  // `VALIDATION_ERROR`, см. `12-api-conventions-auth-tenancy.md` §«коды ошибок»). Опционален и
  // добавлен для DTJ-199 (карта аптек, SRS-CAT-054) — существующие вызовы конструктора без
  // `details` продолжают работать без изменений.
  public readonly details: unknown

  // `message`/`details` сгруппированы в один options-объект — иначе конструктор с 4 позиционными
  // параметрами упирается в max-params (C5, eslint.config.mjs).
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

/**
 * Непрозрачная форма `meta` конверта (DTJ-193, `SRS-API-004/005` — курсорная пагинация и прочие
 * необязательные поля `ok(data, meta)`, `@dorutj/contracts`). Форма намеренно НЕ импортирована из
 * `@dorutj/contracts` (`EnvelopeMeta`) — этот файл остаётся `shared`
 * (`.dependency-cruiser.cjs` `fe-shared-is-lowest`), а типизировать `meta` конкретной формой
 * пагинации здесь означало бы завязать shared-слой на форму ответа ОДНОГО эндпоинта; вызывающий
 * код (`search-results.api.ts`) сам знает, какую форму `meta` ожидать, и распаковывает по месту.
 */
export type JsonMeta = Readonly<Record<string, unknown>>

interface SuccessEnvelope<T> {
  readonly data: T
  readonly meta?: JsonMeta
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

/** Успешный ответ, распакованный ИЗ конверта, вместе с `meta` (DTJ-193 — курсорная пагинация). */
export interface JsonEnvelopeResult<T> {
  readonly data: T
  readonly meta: SuccessEnvelope<T>['meta']
}

/**
 * Общее ядро `httpRequestJson`/`httpRequestJsonWithMeta` — парсит `envelope`, бросает `HttpError`
 * на неуспех. Статус ответа (`response.status`) сохраняется в `HttpError.status` ВСЕГДА, даже
 * когда `error.code` в теле обобщён до `INTERNAL_ERROR` (см. `HttpError.status`, использующий
 * реальный `response.status`, — единственный надёжный сигнал для 5xx-состояний вроде
 * `SRS-CAT-075`, где `DomainExceptionFilter` урезает `details`/`code` для ЛЮБОГО статуса `>=500`
 * прежде, чем тело покидает сервер).
 *
 * `onResponse` (DTJ-234, корзина) — опциональный callback, вызываемый СРАЗУ после получения
 * `Response`, ДО чтения/парсинга тела и ДО возможного `throw HttpError`. Нужен эндпоинтам,
 * которые несут значимые данные в заголовках ответа независимо от успеха/ошибки тела —
 * `GET/POST/PATCH /api/v1/cart*` ставят `X-Cart-Session-Token` (`cart-identity.guard.ts`,
 * D-EP09-23) даже когда сам запрос завершается бизнес-ошибкой (`applyIssuedSessionToken`
 * вызывается в контроллере ДО `throw result.error`) — эта информация была бы потеряна, если
 * читать заголовки только из успешной ветки. Существующие вызовы без 3-го аргумента не
 * меняют поведение (опциональный параметр, по умолчанию `undefined`).
 */
/** Вынесено из `requestJsonEnvelope` (DTJ-234 добавил туда `onResponse`-ветку, толкнув
 *  `complexity` за порог 10) — заодно читаемее: одна ответственность на функцию. */
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

export async function requestJsonEnvelope<T>(
  path: string,
  init: HttpClientOptions = {},
  onResponse?: (response: Response) => void,
): Promise<JsonEnvelopeResult<T>> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await httpRequest(path, { ...init, headers })
  onResponse?.(response)
  const text = await response.text()
  const parsed = parseResponseBody(text, path, response.status)
  if (response.ok && isSuccessEnvelope<T>(parsed)) {
    return { data: parsed.data, meta: parsed.meta }
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

export async function httpRequestJson<T>(path: string, init: HttpClientOptions = {}): Promise<T> {
  return (await requestJsonEnvelope<T>(path, init)).data
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

export type QueryParams = Readonly<Record<string, string | undefined>>

/** `undefined`-значения опускаются из query-строки, а не сериализуются как `"undefined"`. */
function buildQueryString(params: QueryParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, value)
    }
  }
  const serialized = search.toString()
  return serialized.length > 0 ? `?${serialized}` : ''
}

/**
 * Удобный helper для GET/JSON с query-параметрами (DTJ-199 — карта аптек и последующие
 * GET-эндпоинты со списком фильтров).
 *
 * `signal` (DTJ-192, `SRS-CAT-027`) — опциональный `AbortSignal`, пробрасывается в `fetch` как
 * есть. Нужен автодополнению поиска: TanStack Query сам отменяет `AbortController` устаревшего
 * запроса при смене `queryKey`/размонтировании — `queryFn` обязана переслать этот сигнал до
 * реального `fetch`, иначе устаревший ответ может прийти позже свежего и переписать состояние
 * (гонка ответов). Необязательный третий параметр — существующие вызовы без него не меняются.
 */
function buildGetUrl(path: string, params?: QueryParams): string {
  return `${path}${params !== undefined ? buildQueryString(params) : ''}`
}

function buildGetInit(signal?: AbortSignal): HttpClientOptions {
  return signal === undefined ? {} : { signal }
}

export function httpGetJson<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
  return httpRequestJson<T>(buildGetUrl(path, params), buildGetInit(signal))
}

/**
 * Как `httpGetJson`, но не отбрасывает `meta` конверта (DTJ-193 — `meta.pagination` курсорной
 * пагинации `GET /medicines/search`, `SRS-API-004/005`). `httpGetJson` остаётся отдельной
 * функцией (не параметром вроде `withMeta?: boolean`) — почти все вызывающие места `meta` не
 * используют вовсе, менять их сигнатуру ради одного нового потребителя не нужно.
 */
export function httpGetJsonWithMeta<T>(
  path: string,
  params?: QueryParams,
  signal?: AbortSignal,
): Promise<JsonEnvelopeResult<T>> {
  return requestJsonEnvelope<T>(buildGetUrl(path, params), buildGetInit(signal))
}
