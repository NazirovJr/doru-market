/**
 * HTTP-контракт `GET /api/v1/tenant/meta` (DTJ-033, EP-01, SRS-INV-047).
 *
 * Нечувствительные клиентские настройки тенанта, нужные кабинету аптеки для UI-порогов
 * (`StaleDataBadge`, DTJ-169) — без денежных лимитов и брендинга.
 */
import { z } from 'zod'

export const TenantMetaResponseSchema = z.object({
  inventoryDeltaSlaMinutes: z.number().int().positive(),
  inventoryManualStaleHours: z.number().int().positive(),
})
export type TenantMetaDto = z.infer<typeof TenantMetaResponseSchema>
