// Инвойсы cash_courier-комиссии (`GET/POST /api/v1/finance/billing-invoices*`), только `super_admin`.
import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'

export const BILLING_INVOICE_STATUS_VALUES = ['draft', 'issued', 'paid', 'overdue', 'void'] as const
export type BillingInvoiceStatus = (typeof BILLING_INVOICE_STATUS_VALUES)[number]

export const BILLING_INVOICE_TYPE_VALUES = ['cash_courier_commission', 'whitelabel_license', 'whitelabel_royalty'] as const
export type BillingInvoiceType = (typeof BILLING_INVOICE_TYPE_VALUES)[number]

/** По умолчанию UI фильтрует именно этот тип — whitelabel-инвойсы вне скоупа R1. */
export const DEFAULT_BILLING_INVOICE_TYPE_FILTER: BillingInvoiceType = 'cash_courier_commission'

const LIFT_INVOICE_BLOCK_REASON_MIN_LENGTH = 10

export const LiftInvoiceBlockBodySchema = z.object({
  reason: z.string().trim().min(LIFT_INVOICE_BLOCK_REASON_MIN_LENGTH),
})
export type LiftInvoiceBlockBodyDto = z.infer<typeof LiftInvoiceBlockBodySchema>

export const BillingInvoicesListQuerySchema = cursorQuerySchema.extend({
  'filter[chainId]': z.string().optional(),
  'filter[type]': z.string().optional(),
  'filter[status]': z.string().optional(),
})
export type BillingInvoicesListQueryDto = z.infer<typeof BillingInvoicesListQuerySchema>

export interface BillingInvoiceDto {
  readonly id: string
  readonly chainId: string
  readonly chainName: string | null
  readonly invoiceType: string
  readonly status: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly subtotalDiram: number
  readonly vatDiram: number
  readonly totalDiram: number
  readonly issuedAt: string | null
  readonly dueAt: string | null
  readonly paidAt: string | null
}
