import { Module } from '@nestjs/common'
import { HealthModule } from './common/health/health.module.js'
import { ConfigModule } from './config/config.module.js'
import { OutboxRelayModule } from './jobs/outbox-relay/outbox-relay.module.js'
import { LicenseExpiryCheckModule } from './jobs/license-expiry-check/license-expiry-check.module.js'
import { InventorySyncFailedModule } from './jobs/inventory-sync-failed/inventory-sync-failed.module.js'
import { PruneSearchQueryLogModule } from './jobs/prune-search-query-log/prune-search-query-log.module.js'
import { CartCleanupModule } from './jobs/cart-cleanup/cart-cleanup.module.js'
import { MockBankAutoPayModule } from './jobs/escrow-timeouts/mock-bank-auto-pay.module.js'
import { EscrowReconciliationModule } from './jobs/payout/escrow-reconciliation.module.js'
import { UnpaidOrderTimeoutModule } from './jobs/escrow-timeouts/unpaid-order-timeout.module.js'
import { PayoutSchedulerModule } from './jobs/payout/payout-scheduler.module.js'
import { CashCommissionAggregationModule } from './jobs/payout/cash-commission-aggregation.module.js'
import { BillingInvoiceOverdueModule } from './jobs/payout/billing-invoice-overdue.module.js'
import { PickupSlaTimeoutModule } from './jobs/escrow-timeouts/pickup-sla-timeout.module.js'
import { PayoutExecutionModule } from './jobs/payout/payout-execution.module.js'
import { SupportSlaMonitorModule } from './jobs/support-sla-monitor/support-sla-monitor.module.js'
import { NotificationDispatchModule } from './jobs/notifications/notification-dispatch.module.js'
import { PartialFulfillmentTimeoutModule } from './jobs/escrow-timeouts/partial-fulfillment-timeout.module.js'
import { PickingSlaWatchdogModule } from './jobs/escrow-timeouts/picking-sla-watchdog.module.js'

/**
 * Барабанный модуль (D-27) — корневой `AppModule` apps/worker. Каждый новый тикет,
 * добавляющий джобу/модуль, правит этот файл ТОЛЬКО добавлением строки в `imports`, перечитав
 * файл непосредственно перед правкой. Инициализирован тикетом DTJ-002.
 */
@Module({
  imports: [
    ConfigModule,
    HealthModule,
    OutboxRelayModule,
    LicenseExpiryCheckModule,
    InventorySyncFailedModule,
    PruneSearchQueryLogModule,
    CartCleanupModule,
    MockBankAutoPayModule,
    EscrowReconciliationModule,
    UnpaidOrderTimeoutModule,
    PayoutSchedulerModule,
    CashCommissionAggregationModule,
    BillingInvoiceOverdueModule,
    PickupSlaTimeoutModule,
    PayoutExecutionModule,
    SupportSlaMonitorModule,
    NotificationDispatchModule,
    PartialFulfillmentTimeoutModule,
    PickingSlaWatchdogModule,
  ],
})
// Класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class AppModule {}
