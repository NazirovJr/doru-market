// Фейковый AUDIT_LOG_QUERY_PORT для finance-ledger.controller.e2e.spec.ts (reconciliation-alerts, АС2).
import type { AuditLogQueryPort } from '@/common/audit/audit-log-query.port.js'

export const ALERTED_ORDER_ID = 'order-y-11111111-1111-1111-1111-111111111111'

export const FAKE_AUDIT_LOG_QUERY_PORT: AuditLogQueryPort = {
  findByFilters: () =>
    Promise.resolve({
      items: [
        {
          id: 'audit-1',
          category: 'ledger_adjustment',
          entityType: 'escrow_ledger',
          entityId: ALERTED_ORDER_ID,
          actorUserId: null,
          action: 'reconciliation_discrepancy_detected',
          reason: 'EscrowReconciliationJob: escrow_ledger discrepancy detected (SRS-PAY-013)',
          metadata: { orderId: ALERTED_ORDER_ID, discrepancyDiram: '500', repeatDetectionCount: 1 },
          requestId: null,
          tenantId: 'tenant-1',
          createdAt: new Date('2026-09-10T00:00:00.000Z'),
        },
      ],
      nextCursor: null,
      hasMore: false,
    }),
}
