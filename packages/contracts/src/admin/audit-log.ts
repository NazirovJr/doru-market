// Единственный источник значений audit_action_category (Postgres enum) — валидация + Select-опции.
// createdAtFrom/createdAtTo — z.coerce.date() принимает и голую дату, и полный ISO-datetime.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'

export const AUDIT_LOG_CATEGORY_VALUES = [
  'payment_override',
  'return_override',
  'dispute_resolution',
  'prescription_access',
  'control_category_change',
  'onboarding_decision',
  'force_cancel_order',
  'ledger_adjustment',
  'role_grant',
] as const

export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORY_VALUES)[number]

export const AuditLogListQuerySchema = cursorQuerySchema.extend({
  category: z.enum(AUDIT_LOG_CATEGORY_VALUES).optional(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  tenantId: z.uuid().optional(),
  createdAtFrom: z.coerce.date().optional(),
  createdAtTo: z.coerce.date().optional(),
})

export type AuditLogListQueryDto = z.infer<typeof AuditLogListQuerySchema>

export interface AuditLogEntryDto {
  readonly id: string
  readonly category: string
  readonly entityType: string
  readonly entityId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly reason: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly tenantId: string | null
  readonly createdAt: string
}
