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
  ],
})
// Класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн фреймворка.
export class AppModule {}
