// Платформенная роль (super_admin/support_agent) недостижима через ChangeStaffRoleBodySchema.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'
import { USER_ROLES, type UserRole } from '../permissions.js'

export const STAFF_ROLE_VALUES = ['pharmacist', 'courier', 'pharmacy_admin'] as const
export type StaffRole = (typeof STAFF_ROLE_VALUES)[number]

export const PLATFORM_ROLE_VALUES = ['super_admin', 'support_agent'] as const
export type PlatformRole = (typeof PLATFORM_ROLE_VALUES)[number]

const GRANT_REASON_MIN_LENGTH = 10

export const UsersListQuerySchema = cursorQuerySchema.extend({
  role: z.enum(USER_ROLES).optional(),
  phoneNumber: z.string().trim().min(1).optional(),
  tenantId: z.uuid().optional(),
})
export type UsersListQueryDto = z.infer<typeof UsersListQuerySchema>

export const DeactivateUserBodySchema = z.object({ isActive: z.literal(false) })
export type DeactivateUserBodyDto = z.infer<typeof DeactivateUserBodySchema>

export const ChangeStaffRoleBodySchema = z.object({ newRole: z.enum(STAFF_ROLE_VALUES) })
export type ChangeStaffRoleBodyDto = z.infer<typeof ChangeStaffRoleBodySchema>

export const GrantPlatformRoleBodySchema = z.object({
  role: z.enum(PLATFORM_ROLE_VALUES),
  reason: z.string().trim().min(GRANT_REASON_MIN_LENGTH),
})
export type GrantPlatformRoleBodyDto = z.infer<typeof GrantPlatformRoleBodySchema>

export interface UserSummaryDto {
  readonly id: string
  readonly tenantId: string
  readonly phoneNumber: string | null
  readonly role: UserRole
  readonly fullName: string | null
  readonly isActive: boolean
  readonly createdAt: string
}
