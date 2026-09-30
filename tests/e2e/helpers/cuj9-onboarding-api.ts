// Возвращает {status, body} (не бросает на !ok) — негативные сценарии читают код ошибки из тела.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'
const LICENSE_PDF_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/onboarding/license-valid.pdf')

export interface HttpOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

interface RawResponse<T> {
  readonly status: number
  readonly body: T
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

/** POST /api/v1/onboarding-documents — загружает license-valid.pdf, возвращает URL. */
export async function uploadLicenseDocument(options: HttpOptions = {}): Promise<string> {
  const base64 = readFileSync(LICENSE_PDF_PATH).toString('base64')
  const result = await call<{ data: { url: string } }>('POST', '/api/v1/onboarding-documents', {
    ...options,
    body: { base64, mimeType: 'application/pdf', fileName: 'license-valid.pdf' },
  })
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`uploadLicenseDocument: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data.url
}

export interface SubmitPharmacyApplicationInput {
  readonly chainId: string
  readonly name: string
  readonly addressText: string
  readonly latitude: number
  readonly longitude: number
  readonly phone: string
  readonly licenseNumber: string
  readonly licenseExpiryDate: string
  readonly pharmacistInChargeName: string
  readonly licenseScanUrl?: string
}

export interface SubmittedPharmacyApplication {
  readonly id: string
  readonly chainId: string
  readonly status: string
}

/** `POST /api/v1/pharmacy-accounts` (`@Public()`) — заявка попадает в `status='draft'`. */
export async function submitPharmacyApplication(
  input: SubmitPharmacyApplicationInput,
  options: HttpOptions = {},
): Promise<SubmittedPharmacyApplication> {
  const result = await call<{ data: SubmittedPharmacyApplication }>('POST', '/api/v1/pharmacy-accounts', {
    ...options,
    body: { ...input, isOpen247: true },
  })
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`submitPharmacyApplication: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}

/** POST /api/v1/pharmacy-accounts/:id/submit — draft → pending_review. */
export async function submitPharmacyForReview(pharmacyId: string, options: HttpOptions = {}): Promise<void> {
  const result = await call('POST', `/api/v1/pharmacy-accounts/${pharmacyId}/submit`, { ...options, body: {} })
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`submitPharmacyForReview: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
}

export interface PendingVerificationItem {
  readonly id: string
  readonly status: string
  readonly submittedAt: string | null
}

/** `GET /api/v1/admin/verifications/pharmacy-accounts?status=...` — только `super_admin`. */
export async function listPendingPharmacyVerifications(
  token: string,
  status: string,
  options: HttpOptions = {},
): Promise<readonly PendingVerificationItem[]> {
  const result = await call<{ data: { items: readonly PendingVerificationItem[] } }>(
    'GET',
    `/api/v1/admin/verifications/pharmacy-accounts?status=${status}`,
    { ...options, token },
  )
  if (result.status !== 200) {
    throw new Error(`listPendingPharmacyVerifications: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data.items
}

export interface ApprovePharmacyApplicationInput {
  readonly token: string
  readonly pharmacyId: string
  readonly checklist: Readonly<Record<string, boolean>>
}

/** `POST /api/v1/admin/verifications/pharmacy-accounts/:id/approve` — возвращает статус ответа для негативных проверок RBAC. */
export async function approvePharmacyApplication(
  input: ApprovePharmacyApplicationInput,
  options: HttpOptions = {},
): Promise<RawResponse<{ readonly data?: { readonly status: string }; readonly error?: { readonly code: string } }>> {
  return call('POST', `/api/v1/admin/verifications/pharmacy-accounts/${input.pharmacyId}/approve`, {
    ...options,
    token: input.token,
    body: { checklist: input.checklist },
  })
}

export interface CreateStaffAccountInput {
  readonly phone: string
  readonly fullName: string
  readonly role: string
  readonly pharmacyId?: string | null
  readonly chainId?: string | null
}

/** POST /api/v1/staff-accounts — актёр super_admin/pharmacy_admin. */
export async function createStaffAccount(
  token: string,
  input: CreateStaffAccountInput,
  options: HttpOptions = {},
): Promise<{ readonly userId: string; readonly role: string }> {
  const result = await call<{ data: { userId: string; role: string } }>('POST', '/api/v1/staff-accounts', {
    ...options,
    token,
    body: input,
  })
  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`createStaffAccount: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}

export interface ManualEntryRow {
  readonly medicineId: string
  readonly priceTjs: number
  readonly quantity: number
  readonly expiryDate: string
}

/** `POST /api/v1/inventory-manual-entry` — актёр обязан иметь `pharmacyId` в JWT-claims (`pharmacy_admin`/`super_admin`). */
export async function ingestInventoryRow(
  token: string,
  row: ManualEntryRow,
  options: HttpOptions = {},
): Promise<{ readonly acceptedRows: number; readonly rejectedRows: number }> {
  const result = await call<{ data: { acceptedRows: number; rejectedRows: number } }>('POST', '/api/v1/inventory-manual-entry', {
    ...options,
    token,
    body: { rows: [row] },
  })
  if (result.status !== 200) {
    throw new Error(`ingestInventoryRow: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}

export interface CatalogMedicineSummary {
  readonly medicineId: string
  readonly tradeName: string
}

interface SearchItem {
  readonly medicineId: string
  readonly cheapestOffer: { readonly pharmacyId: string } | null
}

/** `GET /api/v1/medicines/search?text=...` — `@Public()`, без авторизации (гость/`customer`). */
export async function searchMedicinesByText(text: string, options: HttpOptions = {}): Promise<readonly SearchItem[]> {
  const result = await call<{ data: readonly SearchItem[] }>('GET', `/api/v1/medicines/search?text=${encodeURIComponent(text)}`, options)
  if (result.status !== 200) {
    throw new Error(`searchMedicinesByText: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}

const CATALOG_LIST_LIMIT = 10
const CATALOG_LIST_OFFSET = 280

// offset ближе к концу общего каталога — меньше шанс коллизии с чужими фикстурами,
// которые обычно берут медикаменты сначала списка.
export async function pickUnstockedCatalogMedicine(options: HttpOptions = {}): Promise<CatalogMedicineSummary> {
  const listResult = await call<{ data: { items: readonly CatalogMedicineSummary[] } }>(
    'GET',
    `/api/v1/medicines?limit=${String(CATALOG_LIST_LIMIT)}&offset=${String(CATALOG_LIST_OFFSET)}`,
    options,
  )
  if (listResult.status !== 200) {
    throw new Error(`pickUnstockedCatalogMedicine: неожиданный статус ${String(listResult.status)}: ${JSON.stringify(listResult.body)}`)
  }
  const candidates = listResult.body.data.items
  for (const candidate of candidates) {
    const found = await searchMedicinesByText(candidate.tradeName, options)
    const match = found.find((item) => item.medicineId === candidate.medicineId)
    if (match?.cheapestOffer == null) {
      return candidate
    }
  }
  throw new Error('pickUnstockedCatalogMedicine: все кандидаты из окна каталога уже имеют активный оффер — расширить offset/limit')
}

export interface MapPin {
  readonly pharmacyId: string
}

export interface GetPharmacyMapPinsInput {
  readonly lat: number
  readonly lon: number
  readonly medicineId: string
}

/** `GET /api/v1/pharmacies/map?bbox=...&medicineId=...` — `@Public()`. */
export async function getPharmacyMapPins(input: GetPharmacyMapPinsInput, options: HttpOptions = {}): Promise<readonly MapPin[]> {
  const delta = 0.05
  const bbox = `${String(input.lon - delta)},${String(input.lat - delta)},${String(input.lon + delta)},${String(input.lat + delta)}`
  const result = await call<{ data: readonly MapPin[] }>('GET', `/api/v1/pharmacies/map?bbox=${bbox}&medicineId=${input.medicineId}`, options)
  if (result.status !== 200) {
    throw new Error(`getPharmacyMapPins: неожиданный статус ${String(result.status)}: ${JSON.stringify(result.body)}`)
  }
  return result.body.data
}
