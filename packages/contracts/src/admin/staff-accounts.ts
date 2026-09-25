// DTJ-364: список/деактивация сотрудников pharmacy_admin. Создание — реиспользует
// POST /api/v1/staff-accounts (DTJ-030), схема которого здесь не дублируется.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'

export const STAFF_ACCOUNT_ROLE_VALUES = ['pharmacist', 'courier'] as const
export type StaffAccountRole = (typeof STAFF_ACCOUNT_ROLE_VALUES)[number]

export const ListStaffAccountsQuerySchema = cursorQuerySchema.extend({
  scope: z.literal('own').optional(),
})
export type ListStaffAccountsQueryDto = z.infer<typeof ListStaffAccountsQuerySchema>

export const DeactivateStaffAccountBodySchema = z.object({ isActive: z.literal(false) })
export type DeactivateStaffAccountBodyDto = z.infer<typeof DeactivateStaffAccountBodySchema>

export interface StaffAccountSummaryDto {
  readonly id: string
  readonly phoneNumber: string | null
  readonly fullName: string | null
  readonly role: StaffAccountRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly isActive: boolean
  readonly createdAt: string
  readonly courierProvisioned: boolean | null
}

/** Тело POST /api/v1/staff-accounts (DTJ-030) — тип для apps/admin, не Zod (валидация на auth-стороне). */
export interface CreateStaffAccountRequestDto {
  readonly phone: string
  readonly fullName: string
  readonly role: StaffAccountRole
  readonly pharmacyId?: string | null
  readonly chainId?: string | null
}

export interface CreateStaffAccountResponseDto {
  readonly userId: string
  readonly role: StaffAccountRole
  readonly temporaryOtpHint: false
}
