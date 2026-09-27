// DTJ-367: PATCH-тела для расписания работы и круговой зоны доставки аптеки. Радиус — простая
// круговая модель (D-06.1 §5.6), полигональные зоны вне MVP.
import { z } from 'zod'

const TIME_HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u
// Верхний предел радиуса — ASSUMPTION (SRS-ADM-050 не задаёт число явно), зеркалирует domain (pharmacy-account-vo.ts).
const MAX_DELIVERY_RADIUS_KM = 50

export const UpdatePharmacyScheduleBodySchema = z
  .object({
    isOpen247: z.boolean(),
    openingTime: z.string().regex(TIME_HH_MM_PATTERN, 'Expected HH:mm').nullable().optional(),
    closingTime: z.string().regex(TIME_HH_MM_PATTERN, 'Expected HH:mm').nullable().optional(),
  })
  .refine((value) => value.isOpen247 || (value.openingTime != null && value.closingTime != null), {
    message: 'openingTime and closingTime are required unless isOpen247 is true',
  })
export type UpdatePharmacyScheduleBodyDto = z.infer<typeof UpdatePharmacyScheduleBodySchema>

export const UpdateDeliveryZoneBodySchema = z.object({
  maxDeliveryRadiusKm: z.coerce.number().positive().max(MAX_DELIVERY_RADIUS_KM),
})
export type UpdateDeliveryZoneBodyDto = z.infer<typeof UpdateDeliveryZoneBodySchema>

export interface PharmacyScheduleDto {
  readonly id: string
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}

export interface PharmacyDeliveryZoneDto {
  readonly id: string
  readonly maxDeliveryRadiusKm: number
}

export type PharmacyScheduleAndZoneDto = PharmacyScheduleDto & Pick<PharmacyDeliveryZoneDto, 'maxDeliveryRadiusKm'>
