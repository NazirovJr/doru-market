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
 *   - `INVENTORY_FACADE_PORT` — НЕ забинжен: `modules/inventory` пока не экспортирует facade
 *     вообще (см. JSDoc `inventory-facade.port.ts`). Добавится одной строкой, когда EP-05 его
 *     заведёт — не блокирует эту реализацию (тот же класс риска, что `PAYMENTS_FACADE` до
 *     DTJ-249, см. `payments/index.ts`).
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
import { ONBOARDING_FACADE_PORT } from './application/ports/onboarding-facade.port.js'
import { ORDERS_FACADE_PORT } from './application/ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT } from './application/ports/payments-facade.port.js'
// INVENTORY_FACADE_PORT существует (файл создан этим тикетом), но НЕ импортирован здесь —
// нет провайдера, который его свяжет (см. JSDoc inventory-facade.port.ts). Импорт без
// использования дал бы неиспользуемый символ — оставлен только в своём файле-порте.

@Module({
  imports: [OnboardingModule, OrdersModule, PaymentsModule],
  controllers: [],
  providers: [
    { provide: ONBOARDING_FACADE_PORT, useExisting: OnboardingFacade },
    { provide: ORDERS_FACADE_PORT, useExisting: ORDERS_FACADE },
    { provide: PAYMENTS_FACADE_PORT, useExisting: PAYMENTS_FACADE },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class AdminModule {}
