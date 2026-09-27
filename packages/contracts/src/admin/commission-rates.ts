// Контракты commission-rates (DTJ-358) — CRUD над platform_fee. 'parapharma' — реальное значение categories.commission_category, не 'parapharmacy'.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'

export const COMMISSION_CATEGORY_VALUES = ['rx', 'otc', 'parapharma'] as const
export type CommissionCategoryValue = (typeof COMMISSION_CATEGORY_VALUES)[number]

const MIN_RATE_BPS = 0
const MAX_RATE_BPS = 10000

export interface CommissionRateDto {
  readonly id: string
  readonly tenantId: string | null
  readonly chainId: string | null
  readonly category: CommissionCategoryValue | null
  readonly rateBps: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
  readonly createdAt: string | null
}

export const CommissionRatesListQuerySchema = cursorQuerySchema.extend({
  'filter[tenantId]': z.uuid().optional(),
  'filter[chainId]': z.uuid().optional(),
  'filter[category]': z.enum(COMMISSION_CATEGORY_VALUES).optional(),
})
export type CommissionRatesListQuery = z.infer<typeof CommissionRatesListQuerySchema>

// Одна схема для POST/PATCH (тот же приём, что UpsertFeatureFlagSchema); category всегда конкретна.
export const UpsertCommissionRateSchema = z
  .object({
    tenantId: z.uuid().optional(),
    chainId: z.uuid().optional(),
    category: z.enum(COMMISSION_CATEGORY_VALUES),
    rateBps: z.coerce.number().int().min(MIN_RATE_BPS).max(MAX_RATE_BPS),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo !== undefined && value.effectiveTo <= value.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'effectiveTo must be after effectiveFrom' })
    }
  })
export type UpsertCommissionRateDto = z.infer<typeof UpsertCommissionRateSchema>
