import type { SubmitChainApplicationRequest, SubmitPharmacyApplicationRequest } from '@dorutj/contracts'
import { httpPostJson } from '@/shared/api/http-client'

/**
 * `onboarding-application.api.ts` (DTJ-076) — тонкий сетевой слой поверх реальных публичных
 * эндпоинтов онбординга (прочитаны целиком): `pharmacy-chains-public.controller.ts` (DTJ-064),
 * `pharmacy-accounts-public.controller.ts` (DTJ-065), `onboarding-documents.controller.ts`
 * (DTJ-065). Все — `@Public()`, без JWT, доступны анонимному посетителю. Ноль своего `fetch` —
 * только `httpPostJson` из `@/shared/api/http-client` (docs/02 §5).
 *
 * `POST /api/v1/onboarding-documents` — тело JSON `{ base64, mimeType, fileName }`
 * (`OnboardingDocumentUploadRequestSchema`), НЕ `multipart/form-data`, вопреки формулировке
 * `27-module-admin-moderation-onboarding.md` SRS-ADM-006 («multipart/form-data») — реализация
 * контроллера, прочитанная целиком, расходится с этим местом спеки (найденное расхождение, см.
 * отчёт сдачи, НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ). Источник истины по коду — реальный
 * `OnboardingDocumentUploadRequestSchema` в `@dorutj/contracts`, ему и следуем здесь.
 */

const PHARMACY_CHAINS_PATH = '/api/v1/pharmacy-chains'
const PHARMACY_ACCOUNTS_PATH = '/api/v1/pharmacy-accounts'
const ONBOARDING_DOCUMENTS_PATH = '/api/v1/onboarding-documents'

export interface SubmitChainApplicationResult {
  readonly id: string
  readonly status: string
}

export interface SubmitPharmacyApplicationResult {
  readonly id: string
  readonly chainId: string
  readonly status: string
}

export interface RequestContactPhoneOtpResult {
  readonly sent: boolean
  readonly challengeId?: string
  readonly expiresAt?: string
}

export interface VerifyContactPhoneResult {
  readonly id: string
  readonly verified: true
}

export interface SubmitForReviewResult {
  readonly id: string
  readonly status: string
}

export interface UploadOnboardingDocumentInput {
  readonly base64: string
  readonly mimeType: string
  readonly fileName: string
}

export interface UploadOnboardingDocumentResult {
  readonly url: string
}

export function submitChainApplication(
  payload: SubmitChainApplicationRequest,
): Promise<SubmitChainApplicationResult> {
  return httpPostJson<SubmitChainApplicationResult>(PHARMACY_CHAINS_PATH, payload)
}

export function requestContactPhoneOtp(chainId: string): Promise<RequestContactPhoneOtpResult> {
  return httpPostJson<RequestContactPhoneOtpResult>(`${PHARMACY_CHAINS_PATH}/${chainId}/request-contact-phone-otp`, {})
}

export function verifyContactPhone(chainId: string, code: string): Promise<VerifyContactPhoneResult> {
  return httpPostJson<VerifyContactPhoneResult>(`${PHARMACY_CHAINS_PATH}/${chainId}/verify-contact-phone`, { code })
}

export function submitChainForReview(chainId: string): Promise<SubmitForReviewResult> {
  return httpPostJson<SubmitForReviewResult>(`${PHARMACY_CHAINS_PATH}/${chainId}/submit`, {})
}

export function submitPharmacyApplication(
  payload: SubmitPharmacyApplicationRequest,
): Promise<SubmitPharmacyApplicationResult> {
  return httpPostJson<SubmitPharmacyApplicationResult>(PHARMACY_ACCOUNTS_PATH, payload)
}

export function submitPharmacyForReview(pharmacyId: string): Promise<SubmitForReviewResult> {
  return httpPostJson<SubmitForReviewResult>(`${PHARMACY_ACCOUNTS_PATH}/${pharmacyId}/submit`, {})
}

export function uploadOnboardingDocument(
  input: UploadOnboardingDocumentInput,
): Promise<UploadOnboardingDocumentResult> {
  return httpPostJson<UploadOnboardingDocumentResult>(ONBOARDING_DOCUMENTS_PATH, input)
}
