export const ORDER_CANCELLATION_PORT = Symbol.for('@dorutj/admin/order-cancellation-port')

export interface AdminOrderCancellationInput {
  readonly tenantId: string
  readonly orderId: string
  readonly reason: 'fraud_or_safety_force_cancel'
  readonly actor: { readonly kind: 'user'; readonly userId: string }
  readonly now: Date
}

export interface OrderCancellationPort {
  cancelInTransaction(input: AdminOrderCancellationInput, tx: unknown): Promise<{ readonly refundRequired: boolean }>
  settleRefund(orderId: string, reason: AdminOrderCancellationInput['reason']): Promise<boolean>
}
