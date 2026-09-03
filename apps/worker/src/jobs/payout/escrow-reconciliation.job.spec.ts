/**
 * Unit-тесты `EscrowReconciliationJob` (DTJ-247) — все три порта замоканы (`vi.fn()`), без
 * реального Postgres/BullMQ. Интеграционное доказательство (реальная SQL-агрегация,
 * app_role-грант) — `escrow-reconciliation.integration.spec.ts` (apps/api/test/integration —
 * см. её JSDoc про причину размещения там).
 */
import { describe, expect, it, vi } from 'vitest'
import { EscrowLedgerImbalanceMetric } from './escrow-ledger-imbalance.metric.js'
import {
  EscrowReconciliationJob,
  EscrowReconciliationPorts,
  type AuditLogPort,
  type EscrowReconciliationScannerPort,
  type ImbalancedOrder,
  type SupportTicketPort,
} from './escrow-reconciliation.job.js'

const DEDUP_DAYS = 7

function fakeScanner(orders: readonly ImbalancedOrder[]): EscrowReconciliationScannerPort {
  return { findImbalancedOrders: vi.fn<EscrowReconciliationScannerPort['findImbalancedOrders']>().mockResolvedValue(orders) }
}

function fakeSupportTickets(overrides: Partial<SupportTicketPort> = {}): SupportTicketPort {
  return {
    findOpenPaymentIssueTicket:
      overrides.findOpenPaymentIssueTicket ?? vi.fn<SupportTicketPort['findOpenPaymentIssueTicket']>().mockResolvedValue(null),
    createSystemAutoPaymentIssueTicket:
      overrides.createSystemAutoPaymentIssueTicket ??
      vi.fn<SupportTicketPort['createSystemAutoPaymentIssueTicket']>().mockResolvedValue({ ticketId: 'ticket-1' }),
  }
}

function fakeAuditLog(overrides: Partial<AuditLogPort> = {}): AuditLogPort {
  return {
    countLedgerAdjustmentEntries: overrides.countLedgerAdjustmentEntries ?? vi.fn().mockResolvedValue(0),
    appendLedgerAdjustment: overrides.appendLedgerAdjustment ?? vi.fn().mockResolvedValue(undefined),
  }
}

function buildJob(input: {
  scanner: EscrowReconciliationScannerPort
  supportTickets: SupportTicketPort
  auditLog: AuditLogPort
}): EscrowReconciliationJob {
  const ports = new EscrowReconciliationPorts(input.scanner, input.supportTickets, input.auditLog)
  return new EscrowReconciliationJob(ports, DEDUP_DAYS, new EscrowLedgerImbalanceMetric(false))
}

const ORDER: ImbalancedOrder = { orderId: 'order-1', tenantId: 'tenant-1', discrepancyDiram: 200n }

describe('EscrowReconciliationJob (DTJ-247)', () => {
  it('AC1: расхождение найдено, тикет ещё не открыт — создаёт support_ticket + audit_log, инкрементирует метрику', async () => {
    const createTicket = vi.fn<SupportTicketPort['createSystemAutoPaymentIssueTicket']>().mockResolvedValue({ ticketId: 't-1' })
    const appendLedger = vi.fn<AuditLogPort['appendLedgerAdjustment']>().mockResolvedValue(undefined)
    const metric = new EscrowLedgerImbalanceMetric(false)
    const job = new EscrowReconciliationJob(
      new EscrowReconciliationPorts(
        fakeScanner([ORDER]),
        fakeSupportTickets({ createSystemAutoPaymentIssueTicket: createTicket }),
        fakeAuditLog({ appendLedgerAdjustment: appendLedger }),
      ),
      DEDUP_DAYS,
      metric,
    )

    const result = await job.runOnce()

    expect(result).toEqual({ imbalancedOrders: 1, newTickets: 1, dedupedTickets: 0 })
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', tenantId: 'tenant-1' }),
    )
    expect(appendLedger).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', discrepancyDiram: 200n, repeatDetectionCount: 1 }),
    )
    expect(metric.value).toBe(1)
  })

  it('AC2 (SRS-PAY-042): расхождение уже зафиксировано, тикет открыт — НЕ создаёт новый тикет, audit_log получает НОВУЮ строку с инкрементированным счётчиком', async () => {
    const createTicket = vi.fn<SupportTicketPort['createSystemAutoPaymentIssueTicket']>()
    const appendLedger = vi.fn<AuditLogPort['appendLedgerAdjustment']>().mockResolvedValue(undefined)
    const job = buildJob({
      scanner: fakeScanner([ORDER]),
      supportTickets: fakeSupportTickets({
        findOpenPaymentIssueTicket: vi.fn().mockResolvedValue({ ticketId: 'existing-ticket' }),
        createSystemAutoPaymentIssueTicket: createTicket,
      }),
      auditLog: fakeAuditLog({
        countLedgerAdjustmentEntries: vi.fn().mockResolvedValue(2), // уже 2 предыдущих обнаружения
        appendLedgerAdjustment: appendLedger,
      }),
    })

    const result = await job.runOnce()

    expect(result).toEqual({ imbalancedOrders: 1, newTickets: 0, dedupedTickets: 1 })
    expect(createTicket).not.toHaveBeenCalled()
    expect(appendLedger).toHaveBeenCalledWith(expect.objectContaining({ repeatDetectionCount: 3 }))
  })

  it('AC3: все заказы сбалансированы (scanner возвращает []) — ни тикет, ни audit_log, метрика не инкрементируется', async () => {
    const createTicket = vi.fn<SupportTicketPort['createSystemAutoPaymentIssueTicket']>()
    const appendLedger = vi.fn<AuditLogPort['appendLedgerAdjustment']>()
    const metric = new EscrowLedgerImbalanceMetric(false)
    const job = new EscrowReconciliationJob(
      new EscrowReconciliationPorts(
        fakeScanner([]),
        fakeSupportTickets({ createSystemAutoPaymentIssueTicket: createTicket }),
        fakeAuditLog({ appendLedgerAdjustment: appendLedger }),
      ),
      DEDUP_DAYS,
      metric,
    )

    const result = await job.runOnce()

    expect(result).toEqual({ imbalancedOrders: 0, newTickets: 0, dedupedTickets: 0 })
    expect(createTicket).not.toHaveBeenCalled()
    expect(appendLedger).not.toHaveBeenCalled()
    expect(metric.value).toBe(0)
  })

  it('несколько заказов одновременно — каждый обрабатывается независимо (create/dedup/error не блокируют соседей)', async () => {
    const orderA: ImbalancedOrder = { orderId: 'order-a', tenantId: 'tenant-1', discrepancyDiram: 50n }
    const orderB: ImbalancedOrder = { orderId: 'order-b', tenantId: 'tenant-1', discrepancyDiram: 75n }
    const findOpen = vi.fn<SupportTicketPort['findOpenPaymentIssueTicket']>().mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-a' ? { ticketId: 'existing' } : null),
    )
    const job = buildJob({
      scanner: fakeScanner([orderA, orderB]),
      supportTickets: fakeSupportTickets({ findOpenPaymentIssueTicket: findOpen }),
      auditLog: fakeAuditLog(),
    })

    const result = await job.runOnce()

    expect(result).toEqual({ imbalancedOrders: 2, newTickets: 1, dedupedTickets: 1 })
  })

  it('одна из обработок падает — остальные заказы всё равно обрабатываются (Promise.allSettled, не Promise.all)', async () => {
    const orderA: ImbalancedOrder = { orderId: 'order-fail', tenantId: 'tenant-1', discrepancyDiram: 10n }
    const orderB: ImbalancedOrder = { orderId: 'order-ok', tenantId: 'tenant-1', discrepancyDiram: 20n }
    const appendLedger = vi.fn<AuditLogPort['appendLedgerAdjustment']>().mockImplementation((input) =>
      input.orderId === 'order-fail' ? Promise.reject(new Error('db down')) : Promise.resolve(undefined),
    )
    const job = buildJob({
      scanner: fakeScanner([orderA, orderB]),
      supportTickets: fakeSupportTickets(),
      auditLog: fakeAuditLog({ appendLedgerAdjustment: appendLedger }),
    })

    const result = await job.runOnce()

    expect(result.imbalancedOrders).toBe(2)
    expect(result.newTickets).toBe(1) // order-ok успешно создал тикет
  })
})
