// Маппинг order_status → BadgeTone, общий для всех страниц заказов.
import { ORDER_STATUS_VALUES as CONTRACT_ORDER_STATUS_VALUES } from '@dorutj/contracts'
import type { BadgeTone } from '@dorutj/ui'

export const ORDER_STATUS_VALUES = CONTRACT_ORDER_STATUS_VALUES

export const ORDER_STATUS_BADGE_TONE: Readonly<Record<string, BadgeTone>> = {
  pending_payment: 'neutral',
  confirmed: 'neutral',
  paid_escrow: 'neutral',
  processing: 'warning',
  picked_up: 'warning',
  delivered: 'success',
  cancelled: 'danger',
  refunded: 'danger',
  return_in_progress: 'warning',
}
