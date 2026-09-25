// Bracket-ключи (SRS-API-007) как литеральные property-имена — Fastify их не вкладывает.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'

export const PharmacyAccountsListQuerySchema = cursorQuerySchema.extend({
  scope: z.literal('own').optional(),
  'filter[status]': z.string().trim().min(1).optional(),
  'filter[chainId]': z.uuid().optional(),
  'filter[name][like]': z.string().trim().min(1).optional(),
})
export type PharmacyAccountsListQueryDto = z.infer<typeof PharmacyAccountsListQuerySchema>

export interface PharmacyAccountAdminSummaryDto {
  readonly id: string
  readonly chainId: string | null
  readonly chainName: string | null
  readonly name: string
  readonly status: string
  readonly licenseExpiryDate: string | null
}
