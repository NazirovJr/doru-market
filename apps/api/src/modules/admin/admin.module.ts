/**
 * NestJS-модуль `admin` (EP-15, DTJ-350). Barrel-файл (D-27): правится ТОЛЬКО добавлением строк,
 * перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * `admin` не имеет собственного домена (`SRS-ADM-002`) — presentation+application-слой поверх
 * ЧЕТЫРЁХ узких портов, каждый связан с РЕАЛЬНЫМ фасадом чужого модуля через `useExisting`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3):
 *   - `ONBOARDING_FACADE_PORT` → `OnboardingFacade` (`@/modules/onboarding`, реален, DTJ-070)
 *   - `ORDERS_FACADE_PORT` → `ORDERS_FACADE` (`@/modules/orders`, реален, DTJ-222)
 *   - `PAYMENTS_FACADE_PORT` → `PAYMENTS_FACADE` (`@/modules/payments`, реален, DTJ-249;
 *     экспорт добавлен ЭТИМ тикетом, см. JSDoc `payments.module.ts`)
 *   - `INVENTORY_FACADE_PORT` → `InventoryFacade` (`@/modules/inventory`, реален, публичный
 *     барабан модуля теперь экспортирует его).
 *
 * DTJ-352 (`feature_flags`) — ЕДИНСТВЕННАЯ таблица этого модуля с СОБСТВЕННЫМ доменом
 * (`domain/feature-flag.entity.ts`, `SRS-ADM-028`) — не фасад чужого модуля, поэтому не идёт
 * через паттерн портов выше. `imports: [AuthModule]` — ДОБАВЛЕНО: `FeatureFlagsController` —
 * первый контроллер этого модуля, использующий `AuthGuard`/`RolesGuard` (тот же приём, что
 * `imports: [AuthModule]` в `support.module.ts`).
 *
 * `tenants` — `TENANCY_FACADE_PORT` через `useClass` (не `useExisting`): у `tenancy` нет своего класса-фасада.
 *
 * `controllers`/`providers` (use case'ы) пополняются СЛЕДУЮЩИМИ тикетами (DTJ-351..367) —
 * СТРОГО добавлением элементов в существующие массивы, не переписывая файл. Если после
 * `DTJ-360` файл превысит C2 (300 строк) — разбиение на суб-модули (`TenantsAdminModule`/
 * `FinanceAdminModule`/…) заводится отдельным рефакторинг-тикетом (см. «Риски» DTJ-350).
 */
import { Module } from '@nestjs/common'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import { OrdersModule } from '@/modules/orders/orders.module.js'
import { ORDERS_FACADE } from '@/modules/orders/index.js'
import { PaymentsModule } from '@/modules/payments/payments.module.js'
import { PAYMENTS_FACADE } from '@/modules/payments/index.js'
import { AuthModule } from '@/modules/auth/index.js'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { InventoryModule } from '@/modules/inventory/inventory.module.js'
import { InventoryFacade } from '@/modules/inventory/index.js'
import { DeliveryModule } from '@/modules/delivery/delivery.module.js'
import { ONBOARDING_FACADE_PORT } from './application/ports/onboarding-facade.port.js'
import { ORDERS_FACADE_PORT } from './application/ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT } from './application/ports/payments-facade.port.js'
import { INVENTORY_FACADE_PORT } from './application/ports/inventory-facade.port.js'
import { FEATURE_FLAGS_REPOSITORY_PROVIDER } from './infrastructure/repositories/feature-flags.repository.js'
import { TENANCY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/tenancy-facade.adapter.js'
import { IDENTITY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/identity-facade.adapter.js'
import { DELIVERY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/delivery-facade.adapter.js'
import { ListFeatureFlagsUseCase } from './application/use-cases/list-feature-flags.use-case.js'
import { UpsertFeatureFlagUseCase } from './application/use-cases/upsert-feature-flag.use-case.js'
import { ListTenantsUseCase } from './application/use-cases/list-tenants.use-case.js'
import { GetTenantUseCase } from './application/use-cases/get-tenant.use-case.js'
import { UpdateTenantSettingsUseCase } from './application/use-cases/update-tenant-settings.use-case.js'
import { ListUsersUseCase } from './application/use-cases/list-users.use-case.js'
import { DeactivateUserUseCase } from './application/use-cases/deactivate-user.use-case.js'
import { ChangeStaffRoleUseCase } from './application/use-cases/change-staff-role.use-case.js'
import { GrantPlatformRoleUseCase } from './application/use-cases/grant-platform-role.use-case.js'
import { ListPharmacyAccountsAnyUseCase } from './application/use-cases/list-pharmacy-accounts-any.use-case.js'
import { ListPharmacyAccountsOwnUseCase } from './application/use-cases/list-pharmacy-accounts-own.use-case.js'
import { GetInventorySummaryUseCase } from './application/use-cases/get-inventory-summary.use-case.js'
import { ListStaffAccountsUseCase } from './application/use-cases/list-staff-accounts.use-case.js'
import { DeactivateStaffAccountUseCase } from './application/use-cases/deactivate-staff-account.use-case.js'
import { ProvisionCourierForChainUseCase } from './application/use-cases/provision-courier-for-chain.use-case.js'
import { ListEscrowLedgerUseCase } from './application/use-cases/list-escrow-ledger.use-case.js'
import { ListPayoutScheduleUseCase } from './application/use-cases/list-payout-schedule.use-case.js'
import { ListReconciliationAlertsUseCase } from './application/use-cases/list-reconciliation-alerts.use-case.js'
import { CreatePharmacyApiKeyUseCase } from './application/use-cases/create-pharmacy-api-key.use-case.js'
import { ListPharmacyApiKeysUseCase } from './application/use-cases/list-pharmacy-api-keys.use-case.js'
import { RevokePharmacyApiKeyUseCase } from './application/use-cases/revoke-pharmacy-api-key.use-case.js'
import { RotatePharmacyApiKeyUseCase } from './application/use-cases/rotate-pharmacy-api-key.use-case.js'
import { SetPharmacyApiKeyMtlsUseCase } from './application/use-cases/set-pharmacy-api-key-mtls.use-case.js'
import { FeatureFlagsController } from './presentation/feature-flags.controller.js'
import { TenantsController } from './presentation/tenants.controller.js'
import { UsersAdminController } from './presentation/users-admin.controller.js'
import { PharmacyAccountsOverviewController } from './presentation/pharmacy-accounts-overview.controller.js'
import { StaffAccountsController } from './presentation/staff-accounts.controller.js'
import { FinanceLedgerController } from './presentation/finance-ledger.controller.js'
import { PharmacyApiKeysController } from './presentation/pharmacy-api-keys.controller.js'

@Module({
  imports: [OnboardingModule, OrdersModule, PaymentsModule, AuthModule, TenancyModule, InventoryModule, DeliveryModule],
  controllers: [FeatureFlagsController, TenantsController, UsersAdminController, PharmacyAccountsOverviewController, StaffAccountsController, FinanceLedgerController, PharmacyApiKeysController],
  providers: [
    { provide: ONBOARDING_FACADE_PORT, useExisting: OnboardingFacade },
    { provide: ORDERS_FACADE_PORT, useExisting: ORDERS_FACADE },
    { provide: PAYMENTS_FACADE_PORT, useExisting: PAYMENTS_FACADE },
    { provide: INVENTORY_FACADE_PORT, useExisting: InventoryFacade },
    // DTJ-352 — feature_flags (см. JSDoc блока выше).
    FEATURE_FLAGS_REPOSITORY_PROVIDER,
    ListFeatureFlagsUseCase,
    UpsertFeatureFlagUseCase,
    TENANCY_FACADE_PORT_PROVIDER,
    ListTenantsUseCase,
    GetTenantUseCase,
    UpdateTenantSettingsUseCase,
    // DTJ-354 — users (IDENTITY_FACADE_PORT над USERS_REPOSITORY чужого модуля auth, тот же приём, что TENANCY_FACADE_PORT).
    IDENTITY_FACADE_PORT_PROVIDER,
    ListUsersUseCase,
    DeactivateUserUseCase,
    ChangeStaffRoleUseCase,
    GrantPlatformRoleUseCase,
    // DTJ-353 — pharmacy-accounts (ONBOARDING_FACADE_PORT.findPharmacyAccountsAny, см. JSDoc порта).
    ListPharmacyAccountsAnyUseCase,
    // scope=own — тот же ONBOARDING_FACADE_PORT, chainId резолвится из actor, не из query.
    ListPharmacyAccountsOwnUseCase,
    GetInventorySummaryUseCase,
    // DTJ-364 — staff-accounts (список/деактивация + провижининг флота, DELIVERY_FACADE_PORT новый).
    DELIVERY_FACADE_PORT_PROVIDER,
    ListStaffAccountsUseCase,
    DeactivateStaffAccountUseCase,
    ProvisionCourierForChainUseCase,
    // DTJ-357 — escrow-ledger/payout-schedule через PAYMENTS_FACADE_PORT; reconciliation-alerts — через AUDIT_LOG_QUERY_PORT (common/audit, @Global()).
    ListEscrowLedgerUseCase,
    ListPayoutScheduleUseCase,
    ListReconciliationAlertsUseCase,
    // DTJ-365 — CRUD ключей 1С аптеки через INVENTORY_FACADE_PORT; rotate/requireMtls — блокер миграции.
    CreatePharmacyApiKeyUseCase,
    ListPharmacyApiKeysUseCase,
    RevokePharmacyApiKeyUseCase,
    RotatePharmacyApiKeyUseCase,
    SetPharmacyApiKeyMtlsUseCase,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class AdminModule {}
