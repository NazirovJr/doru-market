// Фейковый PAYMENTS_FACADE_PORT для finance-ledger.controller.e2e.spec.ts — АС2 тикета
// (заказ Y с расхождением) зафиксирован здесь как фикстура, без реального audit_log.
import type { PaymentsFacadePort } from '@/modules/admin/application/ports/payments-facade.port.js'

export const ALERTED_ORDER_ID = 'order-y-11111111-1111-1111-1111-111111111111'

export const FAKE_PAYMENTS_FACADE_PORT: PaymentsFacadePort = {
  findEscrowLedgerEntries: (filter) =>
    Promise.resolve({
      items:
        filter.orderId === undefined
          ? []
          : [
              {
                orderId: filter.orderId,
                entryType: 'hold_created',
                direction: 'debit',
                amountDiram: 10_000,
                reason: null,
                actorUserId: null,
                paymentTransactionRef: 'tx-1',
                createdAt: new Date('2026-09-01T00:00:00.000Z'),
              },
            ],
      nextCursor: null,
      hasMore: false,
    }),
  findPayoutSchedule: () =>
    Promise.resolve({
      items: [
        {
          orderId: 'order-1',
          orderNumber: 'DTJ-260904-00001',
          pharmacyId: 'pharmacy-1',
          grossAmountDiram: 20_000,
          commissionDiram: 1_600,
          netAmountDiram: 18_400,
          status: 'due',
          dueAt: new Date('2026-09-05T00:00:00.000Z'),
          paidAt: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
  findReconciliationAlerts: () =>
    Promise.resolve({
      items: [
        {
          orderId: ALERTED_ORDER_ID,
          tenantId: 'tenant-1',
          discrepancyDiram: 500,
          repeatDetectionCount: 1,
          detectedAt: new Date('2026-09-10T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
}
