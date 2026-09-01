/**
 * Zod-схемы и типы DTO модуля `onboarding` (EP-03).
 *
 * Источники:
 * - DTJ-064: `SubmitChainApplicationRequestSchema`, `VerifyChainContactPhoneRequestSchema`
 * - DTJ-065: `SubmitPharmacyApplicationRequestSchema` (дополнение)
 * - DTJ-066: `submitChainForReview`, `submitPharmacyForReview` (через path-параметр)
 * - DTJ-068: схемы `approve`/`requestChanges`/`reject`/`terminate` (4×2)
 */
import { z } from 'zod'

/** Валидация формата телефона РТ: 9 цифр, опционально с `+992` префиксом. */
const PHONE_REGEX = /^\+?992\d{9}$|^9\d{8}$/u

export const PHONE_NUMBER_MESSAGE =
  'Phone must be in format +992XXXXXXXXX or 9XXXXXXXX (Tajikistan)'

const TIN_INN_MIN = 9
const TIN_INN_MAX = 20
const NAME_MAX_LENGTH = 255
const ADDRESS_MAX_LENGTH = 1024
const LICENSE_MAX_LENGTH = 100
const LAT_MIN = -90
const LAT_MAX = 90
const LON_MIN = -180
const LON_MAX = 180

export const SubmitChainApplicationRequestSchema = z
  .object({
    legalEntityName: z.string().min(1).max(NAME_MAX_LENGTH),
    tinInn: z
      .string()
      .min(TIN_INN_MIN)
      .max(TIN_INN_MAX)
      .regex(/^\d+$/u, 'tinInn must be digits only'),
    legalAddress: z.string().min(1).max(ADDRESS_MAX_LENGTH).nullable().default(null),
    directorFullName: z.string().min(1).max(NAME_MAX_LENGTH),
    contactPhone: z.string().regex(PHONE_REGEX, PHONE_NUMBER_MESSAGE),
    isWhitelabelRequested: z.boolean().default(false),
    registrationCertificateUrl: z.url().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isWhitelabelRequested) {
      if (data.legalAddress === null || data.legalAddress.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['legalAddress'],
          message: 'legalAddress is required when isWhitelabelRequested is true',
        })
      }
      if (
        data.registrationCertificateUrl === undefined ||
        data.registrationCertificateUrl === null ||
        data.registrationCertificateUrl.trim() === ''
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['registrationCertificateUrl'],
          message: 'registrationCertificateUrl is required when isWhitelabelRequested is true',
        })
      }
    }
  })

export type SubmitChainApplicationRequest = z.infer<typeof SubmitChainApplicationRequestSchema>

export const VerifyChainContactPhoneRequestSchema = z.object({
  code: z.string().regex(/^\d{4,6}$/u, 'OTP code must be 4-6 digits'),
})

export type VerifyChainContactPhoneRequest = z.infer<typeof VerifyChainContactPhoneRequestSchema>

/** Schema для `POST /pharmacy-chains/:id/request-contact-phone-otp` (нет тела). */
export const RequestContactPhoneOtpRequestSchema = z.object({}).strict()
export type RequestContactPhoneOtpRequest = z.infer<typeof RequestContactPhoneOtpRequestSchema>

/** Schema для `POST /pharmacy-chains/:id/submit` (нет тела). */
export const SubmitChainForReviewRequestSchema = z.object({}).strict()
export type SubmitChainForReviewRequest = z.infer<typeof SubmitChainForReviewRequestSchema>

/** Schema для `POST /pharmacy-accounts/:id/submit` (нет тела). */
export const SubmitPharmacyForReviewRequestSchema = z.object({}).strict()
export type SubmitPharmacyForReviewRequest = z.infer<typeof SubmitPharmacyForReviewRequestSchema>

/** Schema для `POST /pharmacy-accounts` (DTJ-065) — заявка аптечной точки. */
export const SubmitPharmacyApplicationRequestSchema = z
  .object({
    chainId: z.uuid().optional(),
    tinInn: z
      .string()
      .min(TIN_INN_MIN)
      .max(TIN_INN_MAX)
      .regex(/^\d+$/u, 'tinInn must be digits only')
      .optional(),
    name: z.string().min(1).max(NAME_MAX_LENGTH),
    addressText: z.string().min(1).max(ADDRESS_MAX_LENGTH),
    landmarkTj: z.string().max(ADDRESS_MAX_LENGTH).nullable().optional(),
    latitude: z.number().min(LAT_MIN).max(LAT_MAX),
    longitude: z.number().min(LON_MIN).max(LON_MAX),
    phone: z.string().regex(PHONE_REGEX, PHONE_NUMBER_MESSAGE),
    isOpen247: z.boolean().default(false),
    openingTime: z.string().nullable().optional(),
    closingTime: z.string().nullable().optional(),
    licenseNumber: z.string().min(1).max(LICENSE_MAX_LENGTH),
    licenseIssuingAuthority: z.string().max(NAME_MAX_LENGTH).nullable().optional(),
    licenseIssueDate: z.string().nullable().optional(),
    licenseExpiryDate: z.string(),
    licenseScanUrl: z.url().nullable().optional(),
    pharmacistInChargeName: z.string().min(1).max(NAME_MAX_LENGTH),
  })
  .superRefine((data, ctx) => {
    if (data.chainId === undefined) {
      if (data.tinInn === undefined || data.tinInn.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['tinInn'],
          message: 'tinInn is required for solo pharmacy (no chainId)',
        })
      }
    }
  })

export type SubmitPharmacyApplicationRequest = z.infer<typeof SubmitPharmacyApplicationRequestSchema>

/** Schema для `POST /onboarding-documents` (DTJ-065) — base64 + meta. */
export const OnboardingDocumentUploadRequestSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  fileName: z.string().min(1).max(NAME_MAX_LENGTH),
})
export type OnboardingDocumentUploadRequest = z.infer<typeof OnboardingDocumentUploadRequestSchema>

// -------- DTJ-068 decision requests --------

const REASON_MIN_LENGTH = 1
const REASON_MAX_LENGTH = 2000

/** Schema для `POST /:subject/:id/approve` — `checklist` обязателен, `notes?`. */
export const ApproveVerificationRequestSchema = z.object({
  checklist: z.record(z.string(), z.boolean()),
  notes: z.string().max(REASON_MAX_LENGTH).optional(),
})
export type ApproveVerificationRequest = z.infer<typeof ApproveVerificationRequestSchema>

const ReasonRequestBase = z.object({
  reason: z.string().min(REASON_MIN_LENGTH).max(REASON_MAX_LENGTH),
})

export const RequestChangesVerificationRequestSchema = ReasonRequestBase
export type RequestChangesVerificationRequest = z.infer<typeof RequestChangesVerificationRequestSchema>

export const RejectVerificationRequestSchema = ReasonRequestBase
export type RejectVerificationRequest = z.infer<typeof RejectVerificationRequestSchema>

export const TerminateVerificationRequestSchema = ReasonRequestBase
export type TerminateVerificationRequest = z.infer<typeof TerminateVerificationRequestSchema>

// -------- DTJ-071 suspension --------

const PHARMACY_SUSPENSION_REASONS = [
  'license_expired',
  'license_revoked',
  'fraud_or_safety',
  'policy_violation',
  'voluntary_pause',
  'unpaid_invoice',
] as const

/** `POST /:id/suspend` (DTJ-071) — причина приостановки. */
export const SuspendPharmacyRequestSchema = z.object({
  reason: z.enum(PHARMACY_SUSPENSION_REASONS),
  notes: z.string().max(REASON_MAX_LENGTH).optional(),
})
export type SuspendPharmacyRequest = z.infer<typeof SuspendPharmacyRequestSchema>

/** `POST /:id/force-cancel-incomplete-orders` (DTJ-071) — причина. */
export const ForceCancelOrdersRequestSchema = ReasonRequestBase
export type ForceCancelOrdersRequest = z.infer<typeof ForceCancelOrdersRequestSchema>

// -------- DTJ-072 revocation --------

/** `POST /pharmacy-verifications/:id/revoke` (DTJ-072) — причина отзыва. */
export const RevokeVerificationRequestSchema = ReasonRequestBase
export type RevokeVerificationRequest = z.infer<typeof RevokeVerificationRequestSchema>
