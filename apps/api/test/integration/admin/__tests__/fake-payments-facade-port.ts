// Фейковый PAYMENTS_FACADE_PORT для finance-ledger.controller.e2e.spec.ts (escrow-ledger/payout-schedule).
import type { PaymentsFacadePort } from '@/modules/admin/application/ports/payments-facade.port.js'

export const FAKE_PAYMENTS_FACADE_PORT: PaymentsFacadePort = {
  findEscrowLedgerEntries: (orderId) =>
    Promise.resolve([
      {
        orderId,
        entryType: 'hold_created',
        direction: 'debit',
        amountDiram: 10_000,
        reason: null,
        actorUserId: null,
        paymentTransactionRef: 'tx-1',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]),
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
  findPayoutScheduleByOrder: () => Promise.resolve(null),
}
