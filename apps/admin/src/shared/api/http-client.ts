import { useAuthStore } from '@/shared/auth/auth-store'

// httpRequest добавляет Bearer/retry-refresh; envelope-хелперы ниже не меняют сигнатуру (admin-client.ts зависит от неё).

interface Env {
  readonly apiBaseUrl: string
}

const DEFAULT_API_BASE_URL = 'http://localhost:3000'

export function getClientEnv(): Env {
  const raw: unknown = import.meta.env.VITE_API_BASE_URL
  if (typeof raw === 'string' && raw.length > 0) {
    return { apiBaseUrl: raw }
  }
  return { apiBaseUrl: DEFAULT_API_BASE_URL }
}

type HttpClientOptions = RequestInit

const HTTP_STATUS_UNAUTHORIZED = 401
const TOKEN_EXPIRED_ERROR_CODE = 'TOKEN_EXPIRED'
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh'
const LOGIN_PATH = '/login'

interface ApiErrorBody {
  readonly error?: { readonly code?: string }
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
  // eslint-disable-next-line no-restricted-globals -- этот файл И ЕСТЬ разрешённый слой api.
  return fetch(url, { ...init, headers: buildHeaders(init.headers) })
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

type RefreshResponseBody = RefreshResponsePayload & { readonly data?: RefreshResponsePayload }

function parseRefreshUser(user: RefreshResponseUser | undefined): ReturnType<typeof useAuthStore.getState>['user'] {
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

interface ParsedRefreshPayload {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly user: ReturnType<typeof useAuthStore.getState>['user']
}

function parseRefreshPayload(body: RefreshResponseBody, currentRefresh: string | null): ParsedRefreshPayload | null {
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
    useAuthStore.getState().setSession({ accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, user: resolvedUser })
  } else {
    useAuthStore.getState().setAccessToken(parsed.accessToken)
  }
}

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
    const parsed = parseRefreshPayload((await response.json()) as RefreshResponseBody, currentRefresh)
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
  useAuthStore.getState().clear()
  window.location.assign(LOGIN_PATH)
}

// Дедупликация параллельных refresh — несколько 401 TOKEN_EXPIRED одновременно ждут один POST.
let inFlightRefresh: Promise<boolean> | null = null

function refreshAccessTokenOnce(): Promise<boolean> {
  inFlightRefresh ??= refreshAccessToken().finally(() => {
    inFlightRefresh = null
  })
  return inFlightRefresh
}

// После перезагрузки accessToken пуст (живёт только в памяти), а refreshToken сохранён: запрос без Bearer получает 401 и лечится refresh'ем.
async function needsRefresh(response: Response, sentWithoutToken: boolean): Promise<boolean> {
  const hasRefreshToken = useAuthStore.getState().refreshToken !== null
  if (sentWithoutToken && hasRefreshToken && response.status === HTTP_STATUS_UNAUTHORIZED) {
    return true
  }
  return isTokenExpired(response)
}

async function requestWithAuthRetry(path: string, init: HttpClientOptions, alreadyRetried: boolean): Promise<Response> {
  const sentWithoutToken = useAuthStore.getState().accessToken === null
  const response = await performRequest(path, init)
  if (!(await needsRefresh(response, sentWithoutToken))) {
    return response
  }
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

export async function httpRequest(path: string, init: HttpClientOptions = {}): Promise<Response> {
  return requestWithAuthRetry(path, init, false)
}

export class HttpError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details: unknown

  constructor(status: number, code: string, options?: { readonly message?: string; readonly details?: unknown }) {
    super(options?.message ?? code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = options?.details
  }
}

export type JsonMeta = Readonly<Record<string, unknown>>

interface SuccessEnvelope<T> {
  readonly data: T
  readonly meta?: JsonMeta
}
interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: unknown }
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  return typeof value === 'object' && value !== null && 'data' in value
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const err = (value as { error?: unknown }).error
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
}

export interface JsonEnvelopeResult<T> {
  readonly data: T
  readonly meta: JsonMeta | undefined
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

async function requestJsonEnvelope<T>(path: string, init: HttpClientOptions = {}): Promise<JsonEnvelopeResult<T>> {
  const headers = new Headers(init.headers)
  const isFormDataBody = init.body instanceof FormData
  if (!headers.has('Content-Type') && init.body !== undefined && !isFormDataBody) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await httpRequest(path, { ...init, headers })
  const text = await response.text()
  const parsed = parseResponseBody(text, path, response.status)
  if (response.ok && isSuccessEnvelope<T>(parsed)) {
    return { data: parsed.data, meta: parsed.meta }
  }
  if (!response.ok && isErrorEnvelope(parsed)) {
    throw new HttpError(response.status, parsed.error.code, {
      ...(parsed.error.message !== undefined && { message: parsed.error.message }),
      details: parsed.error.details,
    })
  }
  throw new HttpError(response.status, 'UNKNOWN_ERROR', {
    message: `Unexpected response shape from ${path} (status=${String(response.status)})`,
  })
}

export type QueryParams = Readonly<Record<string, string | undefined>>

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

export function httpGetJson<T>(path: string, params?: QueryParams): Promise<T> {
  return requestJsonEnvelope<T>(`${path}${params !== undefined ? buildQueryString(params) : ''}`).then((r) => r.data)
}

export function httpGetJsonWithMeta<T>(path: string, params?: QueryParams): Promise<JsonEnvelopeResult<T>> {
  return requestJsonEnvelope<T>(`${path}${params !== undefined ? buildQueryString(params) : ''}`)
}

export function httpPostJson<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  return requestJsonEnvelope<T>(path, { method: 'POST', body: JSON.stringify(body), ...(headers !== undefined && { headers }) }).then((r) => r.data)
}

export function httpPatchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJsonEnvelope<T>(path, { method: 'PATCH', body: JSON.stringify(body) }).then((r) => r.data)
}
