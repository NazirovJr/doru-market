// eventType -> category (грубая группировка для notification_preferences); ASSUMPTION: раскладка не 1:1 из спеки, составлена по смыслу события.
// Событие без записи здесь -> resolveNotificationCategory возвращает null (предпочтения не проверяются, доставка как раньше).
export const NOTIFICATION_EVENT_CATEGORIES: Readonly<Record<string, string>> = {
  'order.paid': 'order_updates',
  'order.processing_started': 'order_updates',
  'order.courier_assigned': 'order_updates',
  'order.delivered': 'order_updates',
  'order.cancelled': 'order_updates',
  'order.refunded': 'order_updates',
  'prescription.needs_clarification': 'order_updates',
  'prescription.decision': 'order_updates',
  'payout.status_changed': 'payout_updates',
  'inventory.sync_errors': 'pharmacy_ops',
  'moderation.queue_digest': 'digests',
  'onboarding.license_expiring': 'onboarding_alerts',
  'onboarding.suspended': 'onboarding_alerts',
  'ops.sla_breached': 'pharmacy_ops',
  'billing.invoice_overdue': 'billing_alerts',
}

export function resolveNotificationCategory(eventType: string): string | null {
  return NOTIFICATION_EVENT_CATEGORIES[eventType] ?? null
}
