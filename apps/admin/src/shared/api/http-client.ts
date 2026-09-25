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

export async function httpRequest(path: string, init: HttpClientOptions = {}): Promise<Response> {
  const url = `${getClientEnv().apiBaseUrl}${path}`
  // eslint-disable-next-line no-restricted-globals -- этот файл И ЕСТЬ разрешённый слой api.
  return fetch(url, init)
}

/**
 * `HttpError`/`httpGetJson`/`httpPostJson` (DTJ-283) — ДОБАВЛЕНО поверх уже существующего
 * `httpRequest` (не переписывает его — `onboarding-queue.page.tsx`, DTJ-075, продолжает работать
 * как раньше). Тот же конверт `{ data, meta? } | { error: { code, message?, details? } }`, что
 * `apps/web/src/shared/api/http-client.ts` (DTJ-234/235) — сюда перенесена ТОЛЬКО
 * envelope-часть, БЕЗ auth-retry/refresh (`apps/admin` пока не имеет собственной аутентификации,
 * `useAuthStore`/Bearer-заголовков здесь нет — см. `git log`/DTJ-075: это отдельный,
 * непройденный тикет каркаса `apps/admin`, не периметр DTJ-283). Когда аутентификация появится,
 * естественная точка для Bearer-заголовка — ВНУТРИ `httpRequest` (единственная функция, шлющая
 * реальный `fetch`) — код ниже не изменится.
 */
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
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await httpRequest(path, { ...init, headers })
  const text = await response.text()
  const parsed = parseResponseBody(text, path, response.status)
  if (response.ok && isSuccessEnvelope<T>(parsed)) {
    return { data: parsed.data, meta: parsed.meta }
  }
  if (!response.ok && isErrorEnvelope(parsed)) {
    // `exactOptionalPropertyTypes` — `message` включается ТОЛЬКО когда определено (envelope
    // `error.message` опционален) — явный `message: undefined` не совпадает с «поле отсутствует».
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

export function httpPostJson<T>(path: string, body: unknown): Promise<T> {
  return requestJsonEnvelope<T>(path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data)
}

/** DTJ-354 — добавлено тем же приёмом, что `httpPostJson` (деактивация/смена роли пользователя). */
export function httpPatchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJsonEnvelope<T>(path, { method: 'PATCH', body: JSON.stringify(body) }).then((r) => r.data)
}
