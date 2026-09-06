/**
 * `ChangeStatusSchema` (EP-14, DTJ-282) — `POST /api/v1/support-tickets/:id/status` body.
 * `'open'` исключён намеренно: домен (`SupportTicketTransitionTarget`, `support-ticket.entity.ts`)
 * не принимает его как ЦЕЛЬ перехода — ни одно ребро состояний не ведёт обратно в `open`.
 */
import { z } from 'zod'

const STATUS_TRANSITION_TARGET_VALUES = ['in_progress', 'resolved', 'closed'] as const

export const ChangeStatusSchema = z.object({
  status: z.enum(STATUS_TRANSITION_TARGET_VALUES),
})

export type ChangeStatusDto = z.infer<typeof ChangeStatusSchema>
