// Частичный патч: непереданное поле не меняется. brandPalette — allowlist токенов (tenancy.ts), без WCAG.
import { z } from 'zod'
import { BrandLogoUrlSchema, BrandPalettePatchSchema } from '../tenancy.js'

const MAX_BRAND_NAME_LENGTH = 255

export interface TenantSummaryDto {
  readonly id: string
  readonly slug: string
  readonly isNeutral: boolean
  readonly customDomain: string | null
  readonly brandName: string
  readonly createdAt: string
}

export interface TenantDetailDto {
  readonly id: string
  readonly slug: string
  readonly isNeutral: boolean
  readonly customDomain: string | null
  readonly brandName: string
  readonly brandLogoUrl: string | null
  readonly brandPalette: Readonly<Record<string, string>>
  readonly codLimitDiram: number
  readonly holdPeriodDays: number
}

export const TenantSettingsPatchSchema = z
  .object({
    brandName: z.string().trim().min(1).max(MAX_BRAND_NAME_LENGTH).optional(),
    brandLogoUrl: BrandLogoUrlSchema.nullable().optional(),
    brandPalette: BrandPalettePatchSchema.optional(),
    codLimitDiram: z.coerce.number().int().nonnegative().optional(),
    holdPeriodDays: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Patch must contain at least one field' })

export type TenantSettingsPatchDto = z.infer<typeof TenantSettingsPatchSchema>
