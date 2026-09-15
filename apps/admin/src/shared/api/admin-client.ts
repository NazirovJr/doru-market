/**
 * `admin-client.ts` (DTJ-350, EP-15) — тонкая обёртка над `shared/api/http-client.ts`
 * (`httpRequest`, существующий с EP-03/DTJ-075) с базовым путём `/api/v1` и единым разбором
 * конверта ошибки `{ error: { code, message, details? } }` (`AllExceptionsFilter`, `apps/api`,
 * см. `common/filters/all-exceptions.filter.ts`).
 *
 * Рендеринг toast'а из пойманного `AdminApiError` — ответственность вызывающего компонента
 * (переиспользует существующие ключи `ux.error.*`, `packages/i18n`, не заводит новый паттерн) —
 * этот файл не рендерит UI (`shared/` ниже `features/`, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §5).
 */
import { httpRequest } from './http-client'

const API_BASE_PATH = '/api/v1'

export interface AdminApiErrorShape {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

export class AdminApiError extends Error {
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(shape: AdminApiErrorShape) {
    super(shape.message)
    this.name = 'AdminApiError'
    this.code = shape.code
    this.details = shape.details
  }
}

const FALLBACK_ERROR_CODE = 'INTERNAL_ERROR'

interface ErrorEnvelopeShape {
  readonly error?: { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }
}

function readDetails(details: unknown): Record<string, unknown> | undefined {
  return typeof details === 'object' && details !== null && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined
}

async function parseErrorEnvelope(response: Response): Promise<AdminApiErrorShape> {
  try {
    const body = (await response.json()) as ErrorEnvelopeShape
    const code = typeof body.error?.code === 'string' ? body.error.code : FALLBACK_ERROR_CODE
    const message = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${String(response.status)}`
    const details = readDetails(body.error?.details)
    // `exactOptionalPropertyTypes`: `details` опускается целиком, а не ставится в `undefined`,
    // если поля не было — не то же самое под этим флагом (D-27-смежное правило C7).
    return details === undefined ? { code, message } : { code, message, details }
  } catch {
    // Тело не JSON/не конверт — не бросаем вторично, отдаём безопасный дефолт (тот же приём,
    // что `AllExceptionsFilter` при неопознанном исключении — наружу только код+статус).
    return { code: FALLBACK_ERROR_CODE, message: `HTTP ${String(response.status)}` }
  }
}

/**
 * Given относительный путь БЕЗ префикса (`'/admin/tenants'`), выполняет запрос к
 * `/api/v1${path}` и парсит JSON-тело. Неуспешный ответ → бросает `AdminApiError`
 * с нормализованным `{code, message, details?}`, не сырой `Response`.
 */
export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await httpRequest(`${API_BASE_PATH}${path}`, init)
  if (!response.ok) {
    throw new AdminApiError(await parseErrorEnvelope(response))
  }
  return (await response.json()) as T
}
