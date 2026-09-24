/** Barrel сида — агрегирует events/*.seed.ts в один плоский массив, pure-data (без Drizzle/pg). */
import { BILLING_INVOICE_OVERDUE_TEMPLATE_ROWS } from './events/billing-invoice-overdue.seed.js'
import { INVENTORY_SYNC_ERRORS_TEMPLATE_ROWS } from './events/inventory-sync-errors.seed.js'
import { MODERATION_QUEUE_DIGEST_TEMPLATE_ROWS } from './events/moderation-queue-digest.seed.js'
import { ONBOARDING_LICENSE_EXPIRING_TEMPLATE_ROWS } from './events/onboarding-license-expiring.seed.js'
import { ONBOARDING_SUSPENDED_TEMPLATE_ROWS } from './events/onboarding-suspended.seed.js'
import { OPS_SLA_BREACHED_TEMPLATE_ROWS } from './events/ops-sla-breached.seed.js'
import { ORDER_CANCELLED_TEMPLATE_ROWS } from './events/order-cancelled.seed.js'
import { ORDER_COURIER_ASSIGNED_TEMPLATE_ROWS } from './events/order-courier-assigned.seed.js'
import { ORDER_DELIVERED_TEMPLATE_ROWS } from './events/order-delivered.seed.js'
import { ORDER_PAID_TEMPLATE_ROWS } from './events/order-paid.seed.js'
import { ORDER_PROCESSING_STARTED_TEMPLATE_ROWS } from './events/order-processing-started.seed.js'
import { ORDER_REFUNDED_TEMPLATE_ROWS } from './events/order-refunded.seed.js'
import { PAYOUT_STATUS_CHANGED_TEMPLATE_ROWS } from './events/payout-status-changed.seed.js'
import { PRESCRIPTION_DECISION_TEMPLATE_ROWS } from './events/prescription-decision.seed.js'
import { PRESCRIPTION_NEEDS_CLARIFICATION_TEMPLATE_ROWS } from './events/prescription-needs-clarification.seed.js'
import type { NotificationTemplateSeedRow } from './types.js'

export type { NotificationTemplateSeedRow } from './types.js'
export { findMissingTemplateCombinations, formatMissingCombination } from './completeness.js'
export type { MissingTemplateCombination, NotificationEventChannelMatrixEntry } from './completeness.js'

export const NOTIFICATION_TEMPLATE_SEED_ROWS: readonly NotificationTemplateSeedRow[] = [
  ...ORDER_PAID_TEMPLATE_ROWS,
  ...ORDER_PROCESSING_STARTED_TEMPLATE_ROWS,
  ...ORDER_COURIER_ASSIGNED_TEMPLATE_ROWS,
  ...ORDER_DELIVERED_TEMPLATE_ROWS,
  ...ORDER_CANCELLED_TEMPLATE_ROWS,
  ...ORDER_REFUNDED_TEMPLATE_ROWS,
  ...PAYOUT_STATUS_CHANGED_TEMPLATE_ROWS,
  ...PRESCRIPTION_NEEDS_CLARIFICATION_TEMPLATE_ROWS,
  ...PRESCRIPTION_DECISION_TEMPLATE_ROWS,
  ...INVENTORY_SYNC_ERRORS_TEMPLATE_ROWS,
  ...MODERATION_QUEUE_DIGEST_TEMPLATE_ROWS,
  ...ONBOARDING_LICENSE_EXPIRING_TEMPLATE_ROWS,
  ...ONBOARDING_SUSPENDED_TEMPLATE_ROWS,
  ...OPS_SLA_BREACHED_TEMPLATE_ROWS,
  ...BILLING_INVOICE_OVERDUE_TEMPLATE_ROWS,
]
