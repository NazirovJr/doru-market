/**
 * NestJS-модуль `orders` (EP-09, DTJ-220). Barrel-файл (D-27): правится ТОЛЬКО добавлением
 * строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * DTJ-223 (корзина) наполняет `providers` первый раз — `CartRepository` (Drizzle,
 * `unique_cart_medicine_pharmacy`) и 4 use case'а `application/cart/**`. Остальные провайдеры
 * (домен `Order`/`OrderItem` — DTJ-221/222, checkout — DTJ-227+, адаптеры оставшихся портов
 * `application/ports/*.port.ts` к `inventory`/`prescriptions`/`onboarding`/`tenancy`/
 * `delivery`/`payments`) — последующими тикетами по мере готовности, см.
 * `tickets/ep06-cart-checkout-money/README.md` «Порядок выполнения».
 *
 * `CATALOG_FACADE_PORT` — TODO(DTJ-227): `AddCartItemUseCase` (DTJ-223) — ПЕРВЫЙ реальный
 * потребитель этого порта (объявлен в DTJ-220 «на будущее», для `CheckoutUseCase`). Без
 * провайдера на этот токен `AddCartItemUseCase` не резолвится Nest'ом и `node dist/main.js`
 * не стартует — правило 10 AGENTS.md («Зависишь от несделанного тикета → застабь порт
 * null-адаптером с TODO и ссылкой на тикет») предписывает именно это, а не отказ от
 * регистрации use case'а (что было бы «написанным, но неподключённым компонентом», правило 2
 * AGENTS.md). `UnimplementedCatalogFacadeAdapter` ниже — временная безопасная деградация
 * (пустые `Map`, никаких бросков): реальный адаптер поверх `CatalogFacade`
 * (`modules/catalog/index.ts`, уже полностью реализован DTJ-096/097) заводит DTJ-227 —
 * явно вне периметра DTJ-223 («Риски»: «здесь только контракт + мок в тестах»). Конфликт
 * между буквальным текстом тикета DTJ-223 (не заводить адаптер) и правилом 2 AGENTS.md
 * (не оставлять написанное неподключённым) решён в пользу AGENTS.md — документ стоит выше
 * `tickets/` в иерархии конфликтов самого же `AGENTS.md` («Карта документов»).
 *
 * `INVENTORY_FACADE_PORT` (DTJ-224) — тот же приём: `AvailabilityCalculator.getStockQuantity`
 * первый реальный потребитель, реального адаптера поверх `modules/inventory` ещё нет (нет даже
 * публичного фасада `modules/inventory/index.ts` на момент DTJ-224 — проверено). `0` от
 * `UnimplementedInventoryFacadeAdapter.getStockQuantity` безопасен: `AvailabilityCalculator`
 * НИКОГДА не блокирует покупку своим результатом (D-EP09-12 §2) — временно `availableQuantity`
 * в ответе `GetCartUseCase` будет `0` для ВСЕХ товаров до DTJ-227, что лишь консервативно
 * предупреждает пользователя, не мешает добавить товар в корзину или оформить заказ.
 * `reserveStock`/`releaseStock` — ЗАПИСЬ (D-EP09-11): бросают, не no-op.
 *
 * `ONBOARDING_FACADE_PORT` (DTJ-225, доработка по замечанию CTO) — `GetCartUseCase` первый
 * реальный потребитель `getPharmacyNames`. `UnimplementedOnboardingFacadeAdapter.getPharmacyNames`
 * → пустая `Map` (ЧТЕНИЕ, D-EP09-11) — `GetCartUseCase` трактует отсутствие записи как «имя
 * неизвестно» (`pharmacyName: null`), НЕ подставляет `pharmacyId` — именно это и было
 * замечанием CTO по исходной версии тикета.
 *
 * D-EP09-16 (`reports/EP09-CTO-BRIEF.md`, решение CTO, отменяет прежние дефолты
 * `isPharmacyActive`/`hasExpiredReservedBatch` этого файла): уточнение D-EP09-11 — «чтение
 * данных» (пустое значение честно значит «данных нет») и «чтение-разрешение» (вопрос «можно
 * ли») — РАЗНЫЕ категории. У чтения-разрешения нет безопасного дефолта: `true` пропускает
 * запрещённое, `false` изображает отказ, которого никто не выносил. Обе заглушки ниже —
 * `UnimplementedOnboardingFacadeAdapter.isPharmacyActive` (SRS-DOM-012, обход
 * `PharmacySuspendedError`) и `UnimplementedInventoryFacadeAdapter.hasExpiredReservedBatch`
 * (REQ-REG-6, обход запрета продажи просроченного) — теперь БРОСАЮТ, как запись.
 *
 * `REFUND_FACADE_PORT` (DTJ-232) — контракт к EP-11, заморожен до волны 8
 * (`reports/EP09-CTO-BRIEF.md` D-EP09-28). `UnimplementedRefundFacadeAdapter.refundFull` —
 * ЗАПИСЬ (возврат денег) — БРОСАЕТ, не «успешно» возвращает ноль сомони (D-EP09-16/28).
 * Владелец маркера — `TODO(EP-11)` (эпик документирован, не нарезан на тикеты — тот же приём,
 * утверждённый CTO для `TODO(R2-4)`, D-EP09-8).
 *
 * **РЕШЕНО (DTJ-227, D-EP09-19).** Все четыре абзаца выше (`CATALOG_FACADE_PORT`/
 * `INVENTORY_FACADE_PORT`/`ONBOARDING_FACADE_PORT`/`ORDER_REPOSITORY_PORT`) описывают
 * ИСТОРИЮ — почему заглушки появились и какая деградация была безопасна. Этим тикетом все
 * четыре null-адаптера СНЯТЫ из `providers` (реальные `CatalogFacadeAdapter`/
 * `InventoryFacadeAdapter`/`OnboardingFacadeAdapter`/`DrizzleOrderRepository`,
 * `infrastructure/adapters|repositories/**`). `UnimplementedInventoryFacadeAdapter`/
 * `UnimplementedOnboardingFacadeAdapter` остаются в файле (экспортированы, конструируются
 * НАПРЯМУЮ юнит-тестом `orders.module.spec.ts`, не через DI) — их поведение (D-EP09-16, бросок
 * на чтении-разрешении) по-прежнему проверяется, просто больше не забинжено в `@Module`. Также
 * добавлены: `PAYMENT_INVOICE_PORT` (`NullPaymentInvoiceAdapter` — по-прежнему бросает,
 * TODO(DTJ-242)), `ORDERS_UNIT_OF_WORK` (Drizzle, D-EP09-21), `IDEMPOTENCY_ATTEMPT_ADAPTER`
 * (D-EP09-18) и `CheckoutUseCase` сам.
 *
 * **РЕШЕНО (DTJ-228/229/230).** `CalculateOrderCostService`/`ResolveBillingStrategyService`
 * (DTJ-228), `ResolveDeliveryAddressService`/`CodPolicyService`/`PaymentMethodEnabledPolicyService`
 * + реальные `TENANCY_FACADE_PORT`/`USER_ADDRESS_FACADE_PORT` (DTJ-229),
 * `ExcludeUnverifiedRxItemsService` (DTJ-230) добавлены в `providers` и подключены в
 * `CheckoutUseCase`. `DELIVERY_FACADE_PORT`/`PRESCRIPTIONS_FACADE_PORT` — НОВЫЕ null-адаптеры
 * (реальных модулей `delivery`/`prescriptions` всё ещё нет, см. их JSDoc ниже перед `@Module`).
 *
 * **РЕШЕНО (DTJ-241).** `NullPaymentInvoiceAdapter` СНЯТ — `PAYMENT_INVOICE_PORT` биндится
 * `{ useExisting: PaymentInvoiceAdapter }` (реализация `payments`-модуля, ре-экспортирована
 * `payments/index.js`). `imports` получил `PaymentsModule` (одностороннее — `orders → payments`
 * уже существовало с DTJ-227, сам порт; `forwardRef` НЕ нужен — `payments` НЕ импортирует
 * `orders` в обратную сторону, см. JSDoc `payments.module.ts`, раздел про
 * `RetryPaymentUseCase`/`no-circular`).
 *
 * `RetryPaymentUseCase`/`RetryPaymentController`/`OrderNotRetryableError` (DTJ-241, SRS-PAY-041,
 * `POST /orders/:id/retry-payment`) — размещены ЗДЕСЬ (`orders`), а НЕ в `payments`, вопреки
 * буквальному `files_owned` тикета DTJ-241: буквальное размещение потребовало бы `payments`
 * читать заказ через `OrdersFacade` (`orders`), что при уже существующей `orders → payments`
 * дало бы циклическую зависимость МОДУЛЕЙ на уровне статических ES-импортов — `pnpm arch:check`
 * (`dependency-cruiser`, встроенное правило `no-circular`) отклоняет это как ошибку, `forwardRef`
 * циклический ES-импорт не убирает (только DI-резолвинг Nest). Реализовано вместо этого:
 * `RetryPaymentUseCase` вызывает УЖЕ существующий `PAYMENT_INVOICE_PORT` (тот же порт, что
 * `CheckoutUseCase`) через `OrdersFacade`/`ORDER_REPOSITORY_PORT` этого же модуля — граф остаётся
 * ОДНОНАПРАВЛЕННЫМ (`orders → payments`). См. DISPUTED в отчёте сдачи DTJ-241.
 *
 * **РЕШЕНО (DTJ-245).** `UnimplementedRefundFacadeAdapter` СНЯТ (класс удалён целиком, не
 * оставлен неиспользуемым — не тестируется напрямую нигде, в отличие от `UnimplementedInventory
 * FacadeAdapter`/`UnimplementedOnboardingFacadeAdapter` выше) — `REFUND_FACADE_PORT` биндится
 * `{ useExisting: RefundFacadeAdapter }` (реализация `payments`-модуля, ре-экспортирована
 * `payments/index.js`, тот же приём, что `PAYMENT_INVOICE_PORT`/DTJ-241). Полный рефанд теперь
 * реально возвращает деньги через `PaymentProvider.refund()` + пишет `escrow_ledger` —
 * `CancelOrderUseCase` больше не бросает на non-cash отмене.
 */
import { Global, Module } from '@nestjs/common'
import {
  type InventoryFacadePort,
  type InventoryFacadeError,
  type BatchSubstitutionError,
  type ReleaseStockItemCommand,
  type ReserveStockItemCommand,
  type ReservedStockLine,
} from './application/ports/inventory-facade.port.js'
import { type OnboardingFacadePort } from './application/ports/onboarding-facade.port.js'
import { CART_REPOSITORY_DRIZZLE_PROVIDER } from './infrastructure/repositories/cart.repository.js'
import { CART_HOLD_STORE_REDIS_PROVIDER } from './infrastructure/adapters/redis-cart-hold-store.adapter.js'
import { AddCartItemUseCase } from './application/cart/add-cart-item.use-case.js'
import { UpdateCartItemQuantityUseCase } from './application/cart/update-cart-item-quantity.use-case.js'
import { RemoveCartItemUseCase } from './application/cart/remove-cart-item.use-case.js'
import { SplitCartByPharmacyUseCase } from './application/cart/split-cart-by-pharmacy.use-case.js'
import { AvailabilityCalculator } from './application/cart/availability-calculator.service.js'
import { ExtendCartHoldUseCase } from './application/cart/extend-cart-hold.use-case.js'
import { GetCartUseCase } from './application/cart/get-cart.use-case.js'
import { ORDER_NUMBER_GENERATOR } from '@/shared-kernel/application/ports/order-number-generator.port.js'
import { RedisOrderNumberGeneratorAdapter } from './infrastructure/adapters/redis-order-number-generator.adapter.js'
import { REFUND_FACADE_PORT } from './application/ports/refund-facade.port.js'
import { OrdersFacade } from './application/orders.facade.js'
import { ORDERS_FACADE } from './index.js'
import { CancelOrderUseCase } from './application/order-lifecycle/cancel-order.use-case.js'
import type { Result } from '@dorutj/domain-kernel'
// DTJ-227 (checkout) — снимает 4 null-адаптера ниже (D-EP09-19) и добавляет оркестрацию.
import { CatalogModule } from '@/modules/catalog/catalog.module.js'
import { OnboardingModule } from '@/modules/onboarding/onboarding.module.js'
import { PAYMENT_INVOICE_PORT } from './application/ports/payment-invoice.port.js'
// DTJ-241 — снимает NullPaymentInvoiceAdapter (D-27, см. JSDoc блока providers ниже).
// Односторонний импорт (orders → payments, НЕ forwardRef — см. JSDoc блока providers).
import { PaymentsModule } from '@/modules/payments/payments.module.js'
// DTJ-245 — снимает UnimplementedRefundFacadeAdapter (D-27, см. JSDoc блока providers ниже).
import { PaymentInvoiceAdapter, RefundFacadeAdapter } from '@/modules/payments/index.js'
// DTJ-241 (SRS-PAY-041) — retry-payment живёт здесь (orders), не в payments, см. JSDoc блока providers.
import { RetryPaymentUseCase } from './application/order-lifecycle/retry-payment.use-case.js'
import { RetryPaymentController } from './presentation/checkout/retry-payment.controller.js'
import { ORDERS_UNIT_OF_WORK_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-orders-unit-of-work.adapter.js'
import { ORDERS_OUTBOX_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-orders-outbox.adapter.js'
import { CATALOG_FACADE_PORT_PROVIDER } from './infrastructure/adapters/catalog-facade.adapter.js'
import { ONBOARDING_FACADE_PORT_PROVIDER } from './infrastructure/adapters/onboarding-facade.adapter.js'
import { INVENTORY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/inventory-facade.adapter.js'
import { ORDER_REPOSITORY_DRIZZLE_PROVIDER } from './infrastructure/repositories/order.repository.js'
import { IDEMPOTENCY_ATTEMPT_ADAPTER_PROVIDER } from './infrastructure/adapters/idempotency-attempt.adapter.js'
import { CheckoutUseCase } from './application/checkout/checkout.use-case.js'
// DTJ-226 (REST-вход в корзину + merge гостевой корзины) — см. JSDoc блока providers ниже.
import { CART_IDENTITY_REPOSITORY_DRIZZLE_PROVIDER } from './infrastructure/repositories/drizzle-cart-identity.repository.js'
import { ResolveOrCreateCartUseCase } from './application/cart/resolve-or-create-cart.use-case.js'
import { MergeGuestCartUseCase } from './application/cart/merge-guest-cart.use-case.js'
import { CartIdentityGuard } from './presentation/cart/guards/cart-identity.guard.js'
import { CartController } from './presentation/cart/cart.controller.js'
import { AuthModule } from '@/modules/auth/auth.module.js'
// DTJ-228/229/230 (расчёт стоимости, адрес/COD/способ оплаты, Rx-исключение) — снимает
// DELIVERY_FACADE_PORT/PRESCRIPTIONS_FACADE_PORT null-адаптерами ниже (порты DTJ-220,
// реальных модулей `delivery`/`prescriptions` ещё нет, тот же приём D-EP09-19/правило 3
// AGENTS.md) и добавляет TENANCY_FACADE_PORT/USER_ADDRESS_FACADE_PORT (реальные адаптеры) +
// все шесть application-сервисов расчёта/политик.
import type { DeliveryFacadePort } from './application/ports/delivery-facade.port.js'
import { DELIVERY_FACADE_PORT } from './application/ports/delivery-facade.port.js'
import type { PrescriptionsFacadePort } from './application/ports/prescriptions-facade.port.js'
import { PRESCRIPTIONS_FACADE_PORT } from './application/ports/prescriptions-facade.port.js'
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { TENANCY_FACADE_PORT_PROVIDER } from './infrastructure/adapters/tenancy-facade.adapter.js'
import { USER_ADDRESS_FACADE_PORT_PROVIDER } from './infrastructure/adapters/user-address-facade.adapter.js'
import { CalculateOrderCostService } from './application/checkout/calculate-order-cost.service.js'
import { ResolveBillingStrategyService } from './application/checkout/resolve-billing-strategy.service.js'
import { ResolveDeliveryAddressService } from './application/checkout/resolve-delivery-address.service.js'
import { ExcludeUnverifiedRxItemsService } from './application/checkout/exclude-unverified-rx-items.service.js'
import { CodPolicyService } from './application/policies/cod-policy.service.js'
import { PaymentMethodEnabledPolicyService } from './application/policies/payment-method-enabled-policy.service.js'
// DTJ-231 (гонки/дрейф цены/двойной клик, SRS-ORD-023) — DetectPriceDriftService, подключён в
// CheckoutUseCase (см. JSDoc use case'а). Идемпотентность/гонка за остаток уже покрыты
// существующей проводкой (IDEMPOTENCY_ATTEMPT_ADAPTER_PROVIDER/INVENTORY_FACADE_PORT_PROVIDER
// выше) — новых провайдеров под них не требуется.
import { DetectPriceDriftService } from './application/checkout/detect-price-drift.service.js'
// DTJ-233 (REST-эндпоинты checkout) — CheckoutController: POST /orders, POST /orders/:id/cancel,
// GET /orders/:id/payment-status (заглушка 501). Использует ТОЛЬКО уже забинженные провайдеры
// (CheckoutUseCase/CancelOrderUseCase — уже в providers[] ниже, USERS_REPOSITORY — экспортирован
// AuthModule, уже в imports[] ниже) — новых провайдеров эта правка не добавляет.
import { CheckoutController } from './presentation/checkout/checkout.controller.js'
// DTJ-253/254 (EP-10) — мост apps/worker → apps/api для системной отмены заказа по таймауту
// (см. JSDoc `system-cancel-order.use-case.ts` «МОСТ МЕЖДУ ПРОЦЕССАМИ»). Новые файлы,
// providers/controllers дополнены строками — существующие не тронуты (D-27).
import { SystemCancelOrderUseCase } from './application/order-lifecycle/system-cancel-order.use-case.js'
import { InternalServiceGuard } from './presentation/internal/internal-service.guard.js'
import { SystemCancelOrderController } from './presentation/internal/system-cancel-order.controller.js'
// DTJ-301 (EP-12, модуль 24 «Терминал фармацевта») — очередь/accept/reclaim. Новых портов не
// требует за пределами уже забинженных (ORDER_REPOSITORY_PORT/ORDERS_UNIT_OF_WORK/ORDERS_OUTBOX/
// INVENTORY_FACADE_PORT/TENANCY_FACADE_PORT — все уже провайдятся выше DTJ-227/228/229).
import { GetOrderQueueUseCase } from './application/pharmacy-terminal/get-order-queue.use-case.js'
import { AcceptOrderUseCase } from './application/pharmacy-terminal/accept-order.use-case.js'
import { ReclaimOrderUseCase } from './application/pharmacy-terminal/reclaim-order.use-case.js'
import { PharmacyTerminalQueueController } from './presentation/pharmacy-terminal/pharmacy-terminal-queue.controller.js'
// DTJ-302 (EP-12, терминал фармацевта §A.3) — ScanOrderItemUseCase +
// PharmacyTerminalItemsController (`POST /orders/:id/items/:itemId/scan`). Использует ТОЛЬКО уже
// забинженные провайдеры (ORDER_REPOSITORY_DRIZZLE_PROVIDER/ORDERS_UNIT_OF_WORK_DRIZZLE_PROVIDER/
// CATALOG_FACADE_PORT_PROVIDER/INVENTORY_FACADE_PORT_PROVIDER — все уже в providers[] ниже) + CLOCK
// (`SharedKernelModule`, `@Global()` — уже резолвится без локальной регистрации, тот же приём,
// что `CancelOrderUseCase` выше — ни один провайдер CLOCK в этом файле не заведён, и не нужен).
import { ScanOrderItemUseCase } from './application/pharmacy-terminal/scan-order-item.use-case.js'
import { PharmacyTerminalItemsController } from './presentation/pharmacy-terminal/pharmacy-terminal-items.controller.js'
// DTJ-303 (EP-12, терминал фармацевта §A.4) — ReportItemIssueUseCase, дописывает второй метод
// (`report-issue`) в УЖЕ созданный DTJ-302 `PharmacyTerminalItemsController` (`presentation/
// pharmacy-terminal/pharmacy-terminal-items.controller.ts`, тот же файл, второй провайдер в
// конструкторе). Использует ТОЛЬКО уже забинженные провайдеры (ORDER_REPOSITORY_DRIZZLE_PROVIDER/
// ORDERS_UNIT_OF_WORK_DRIZZLE_PROVIDER/INVENTORY_FACADE_PORT_PROVIDER — все уже в providers[]
// ниже) + PINO_LOGGER (`LoggerModule`, `@Global()` — тот же приём, что `CancelOrderUseCase`).
import { ReportItemIssueUseCase } from './application/pharmacy-terminal/report-item-issue.use-case.js'
// DTJ-304 (EP-12, терминал фармацевта §A.4) — ProposePartialFulfillmentUseCase/
// ResolvePartialFulfillmentUseCase + PartialFulfillmentController (клиентский propose) +
// PartialFulfillmentTimeoutController (мост apps/worker → apps/api для BullMQ-таймаута, см.
// JSDoc PartialFulfillmentTimeoutProcessor «DISPUTED»). Новые провайдеры сверх уже забинженных
// DTJ-227/228/301/303 (см. их комментарии выше): PARTIAL_FULFILLMENT_REQUEST_REPOSITORY (порт+
// Drizzle-репозиторий, необходимое расширение — DTJ-300 завела только схему, см. JSDoc порта) и
// PARTIAL_FULFILLMENT_TIMEOUT_QUEUE (BullMQ-producer, необходимое расширение). CATALOG_FACADE_PORT/
// TENANCY_FACADE_PORT/INVENTORY_FACADE_PORT/REFUND_FACADE_PORT — уже забинжены выше.
import { PARTIAL_FULFILLMENT_REQUEST_REPOSITORY_DRIZZLE_PROVIDER } from './infrastructure/repositories/partial-fulfillment-request.repository.js'
import { PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_PROVIDER } from './infrastructure/jobs/partial-fulfillment-timeout.processor.js'
import { ProposePartialFulfillmentUseCase } from './application/pharmacy-terminal/propose-partial-fulfillment.use-case.js'
import { ResolvePartialFulfillmentUseCase } from './application/pharmacy-terminal/resolve-partial-fulfillment.use-case.js'
import { PartialFulfillmentController } from './presentation/pharmacy-terminal/partial-fulfillment.controller.js'
import { PartialFulfillmentTimeoutController } from './presentation/internal/partial-fulfillment-timeout.controller.js'
// DTJ-305 (EP-12, терминал фармацевта §A.5) — CompletePickingUseCase + CompletePickingController
// (`POST /orders/:id/complete-picking`). Новых провайдеров сверх уже забинженных DTJ-227/301/304
// (см. их комментарии выше) не требует — `OTP_GENERATOR`/`OTP_CODES_REPOSITORY` резолвятся из
// уже импортированного `AuthModule` (см. `imports:` ниже, экспортированы `auth.module.ts`), тот
// же приём межмодульного потребления, что `JWT_SIGNER` в `CartIdentityGuard`.
// `PARTIAL_FULFILLMENT_REQUEST_REPOSITORY` получил новый метод порта (`findLatestByOrderId`,
// см. её JSDoc) — необходимое расширение, тот же класс решения, что `InventoryFacadePort.
// getStockQuantity`/`reserveForOrder` (DTJ-224/302).
import { CompletePickingUseCase } from './application/pharmacy-terminal/complete-picking.use-case.js'
import { CompletePickingController } from './presentation/pharmacy-terminal/complete-picking.controller.js'

// DTJ-306 (EP-12, терминал фармацевта §A.5) — GetHandoverOtpUseCase/RegenerateHandoverOtpUseCase +
// HandoverOtpController (`GET .../handover-otp`, `POST .../handover-otp/regenerate`). Новых
// провайдеров сверх уже забинженных DTJ-227/301/304/305 не требует — `AUDIT_LOG_PORT` резолвится
// из `@Global()` `AuditLogModule` (DTJ-374, без явного import), `OTP_GENERATOR`/`OTP_CODES_REPOSITORY`
// — из уже импортированного `AuthModule`, тот же приём, что `CompletePickingUseCase` выше.
import { GetHandoverOtpUseCase } from './application/pharmacy-terminal/get-handover-otp.use-case.js'
import { RegenerateHandoverOtpUseCase } from './application/pharmacy-terminal/regenerate-handover-otp.use-case.js'
import { HandoverOtpController } from './presentation/pharmacy-terminal/handover-otp.controller.js'

// DTJ-307 (EP-12, SLA сборки) — мягкое нарушение SLA: internal-эндпоинт для apps/worker.
import { ReportPickingSlaBreachUseCase } from './application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { PickingSlaBreachController } from './presentation/internal/picking-sla-breach.controller.js'
// DTJ-307 (EP-12, SLA сборки) — постановка мягкого и жёсткого watchdog-джоба при accept.
import { ScheduleSlaWatchdogUseCase } from './application/pharmacy-terminal/schedule-sla-watchdog.use-case.js'
import { SLA_WATCHDOG_QUEUE_PROVIDER } from './infrastructure/jobs/sla-watchdog.processor.js'

/**
 * `UnimplementedCatalogFacadeAdapter`/`UnimplementedOrderRepositoryAdapter` (DTJ-220/222) —
 * СНЯТЫ этим тикетом (D-EP09-19): реальные `CatalogFacadeAdapter`
 * (`infrastructure/adapters/catalog-facade.adapter.ts`) и `DrizzleOrderRepository`
 * (`infrastructure/repositories/order.repository.ts`) заменяют их провайдеры целиком в
 * `@Module` ниже — см. `CATALOG_FACADE_PORT_PROVIDER`/`ORDER_REPOSITORY_DRIZZLE_PROVIDER`.
 *
 * NullAdapter (DTJ-224, тот же приём, что выше — правило 15 AGENTS.md, TODO(DTJ-227) в JSDoc
 * модуля). `reserveStock`/`releaseStock` — ЗАПИСЬ (D-EP09-11) — бросают. `getStockQuantity` —
 * ЧТЕНИЕ ДАННЫХ (D-EP09-11/16) — `0`, безопасно: результат `AvailabilityCalculator` никогда не
 * блокирует покупку (D-EP09-12 §2), временный `0` — консервативное предупреждение, не отказ в
 * обслуживании. `hasExpiredReservedBatch` — ЧТЕНИЕ-РАЗРЕШЕНИЕ (D-EP09-16, решение CTO,
 * ОТМЕНЯЕТ прежнее «`always false`» — у вопроса «просрочена ли партия» нет безопасного дефолта:
 * `false` от заглушки означало бы «нет» и обходило бы REQ-REG-6) — теперь БРОСАЕТ, как запись.
 * Экспортирован для юнит-теста (`orders.module.spec.ts`) — иначе поведение заглушки
 * непроверяемо, класс жил только внутри модуля.
 */
export class UnimplementedInventoryFacadeAdapter implements InventoryFacadePort {
  reserveStock(
    _pharmacyId: string,
    _items: readonly ReserveStockItemCommand[],
  ): Promise<Result<readonly ReservedStockLine[], InventoryFacadeError>> {
    return Promise.reject(
      new Error('InventoryFacadePort.reserveStock() has no implementation yet — TODO(DTJ-227): bind a real adapter.'),
    )
  }

  releaseStock(_items: readonly ReleaseStockItemCommand[]): Promise<void> {
    return Promise.reject(
      new Error('InventoryFacadePort.releaseStock() has no implementation yet — TODO(DTJ-227): bind a real adapter.'),
    )
  }

  hasExpiredReservedBatch(_orderId: string): Promise<boolean> {
    return Promise.reject(
      new Error(
        'InventoryFacadePort.hasExpiredReservedBatch() has no implementation yet — TODO(DTJ-227): bind a real adapter. ' +
          'D-EP09-16: чтение-разрешение без безопасного дефолта, false обошёл бы REQ-REG-6.',
      ),
    )
  }

  getStockQuantity(_pharmacyId: string, _medicineId: string): Promise<number> {
    return Promise.resolve(0)
  }

  /**
   * DTJ-302 — метод добавлен в интерфейс ПОСЛЕ того, как DTJ-227 заменил этот класс в DI (см.
   * JSDoc файла выше «РЕШЕНО (DTJ-227)») — этот стаб больше нигде не биндится, кроме прямого
   * конструирования в `orders.module.spec.ts`; реальная реализация уже есть в
   * `InventoryFacadeAdapter.reserveForOrder` (`infrastructure/adapters/inventory-facade.adapter.ts`).
   * Бросает, как `reserveStock`/`releaseStock` выше (та же категория — ЗАПИСЬ/резервирование,
   * D-EP09-11) — существует исключительно чтобы `implements InventoryFacadePort` продолжал типиться.
   */
  // eslint-disable-next-line max-params -- сигнатура фиксирована интерфейсом `InventoryFacadePort.reserveForOrder` (позиционные параметры порта, не выбор этого файла).
  reserveForOrder(
    _pharmacyId: string,
    _medicineId: string,
    _batchNumber: string,
    _quantity: number,
  ): Promise<Result<{ readonly batchId: string }, BatchSubstitutionError>> {
    return Promise.reject(
      new Error(
        'InventoryFacadePort.reserveForOrder() has no implementation on this legacy stub — see ' +
          'InventoryFacadeAdapter for the real implementation (DTJ-302/DTJ-227).',
      ),
    )
  }

  /** DTJ-303 — тот же приём, что `reserveForOrder` выше: метод добавлен интерфейсом после того, как DTJ-227 заменил этот класс в DI. Бросает — та же категория ЗАПИСЬ (сигнализирует расхождение остатка), что `reserveStock`/`releaseStock`/`reserveForOrder`. */
  reconcileZeroStock(_medicineId: string, _batchId: string): Promise<void> {
    return Promise.reject(
      new Error(
        'InventoryFacadePort.reconcileZeroStock() has no implementation on this legacy stub — see ' +
          'InventoryFacadeAdapter for the real implementation (DTJ-303/DTJ-227).',
      ),
    )
  }
}

/**
 * NullAdapter (DTJ-225, доработка по замечанию CTO — тот же приём, что выше, правило 15
 * AGENTS.md, TODO(DTJ-227) в JSDoc модуля). `getPharmacyNames` — ЧТЕНИЕ ДАННЫХ (D-EP09-11) —
 * пустая `Map`, безопасно: `GetCartUseCase` трактует отсутствие записи как «имя неизвестно» и
 * отдаёт `pharmacyName: null`, НИКОГДА не подставляет `pharmacyId`. `isPharmacyActive` —
 * ЧТЕНИЕ-РАЗРЕШЕНИЕ (D-EP09-16, решение CTO, ОТМЕНЯЕТ прежнее «`true` — консервативный дефолт»
 * — для вопроса «можно ли продавать через эту аптеку» консервативно ровно наоборот: `true` от
 * заглушки означало бы отключённую проверку приостановки аптеки, SRS-DOM-012, обход
 * `PharmacySuspendedError`) — теперь БРОСАЕТ, как запись. Экспортирован для юнит-теста.
 */
export class UnimplementedOnboardingFacadeAdapter implements OnboardingFacadePort {
  isPharmacyActive(_pharmacyId: string): Promise<boolean> {
    return Promise.reject(
      new Error(
        'OnboardingFacadePort.isPharmacyActive() has no implementation yet — TODO(DTJ-227): bind a real adapter. ' +
          'D-EP09-16: чтение-разрешение без безопасного дефолта, true обошёл бы SRS-DOM-012.',
      ),
    )
  }

  getPharmacyNames(): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(new Map())
  }
}

/**
 * NullAdapter (DTJ-228, тот же приём — правило 15 AGENTS.md, TODO(EP-13) в JSDoc модуля).
 * Реального модуля `delivery` физически нет (EP-13, JSDoc порта: «стартует волной 9»).
 * `calculateFee` — НЕ вызывается сегодня в проде вовсе: `CalculateOrderCostService.
 * resolveDeliveryFee` короtит на `pharmacyGeoPoint === null` (известный пробел
 * `OnboardingFacadePort`, `CalculateOrderCostInput` JSDoc) — этот адаптер существует ТОЛЬКО
 * чтобы `TENANCY_FACADE_PORT`-соседний токен `DELIVERY_FACADE_PORT` резолвился Nest'ом (иначе
 * `CalculateOrderCostService`/`CheckoutUseCase` не собираются). Бросает, не «правдоподобный
 * 0» — если предположение «порт не вызывается» когда-нибудь перестанет быть верным (`Onboarding
 * FacadePort` начнёт нести геоточку аптеки), тихий `0` дал бы неверную (заниженную) стоимость
 * доставки клиенту молча — тот же класс риска, что D-EP09-16 для чтения-разрешения.
 */
export class UnimplementedDeliveryFacadeAdapter implements DeliveryFacadePort {
  calculateFee(): Promise<bigint> {
    return Promise.reject(
      new Error('DeliveryFacadePort.calculateFee() has no implementation yet — TODO(EP-13): bind a real adapter.'),
    )
  }
}

/**
 * NullAdapter (DTJ-230, тот же приём). Модуль `prescriptions` не закреплён ни за одним EP
 * (`prescriptions-facade.port.ts` JSDoc) — владелец/срок неизвестны. В ОТЛИЧИЕ от
 * `UnimplementedDeliveryFacadeAdapter` выше, ЭТОТ порт РЕАЛЬНО вызывается в проде уже сегодня
 * (`ExcludeUnverifiedRxItemsService` — на КАЖДОЙ Rx-позиции корзины). `isVerifiedFor` —
 * ЧТЕНИЕ-РАЗРЕШЕНИЕ (D-EP09-16, та же формулировка, что в шапке файла: «`true` пропускает
 * запрещённое, `false` изображает отказ, которого никто не выносил») — БРОСАЕТ, НЕ `false`:
 * `false`-заглушка тихо исключала бы ЛЮБУЮ Rx-позицию ЛЮБОГО customer'а из ЛЮБОГО checkout
 * без базы для этого решения, неотличимо от «этот конкретный рецепт не верифицирован».
 * Практическое следствие — checkout корзины с Rx-позицией ломается 500-кой до появления
 * реального модуля; корзины без Rx-позиций не затронуты (порт не вызывается для них вовсе).
 */
export class UnimplementedPrescriptionsFacadeAdapter implements PrescriptionsFacadePort {
  isVerifiedFor(): Promise<boolean> {
    return Promise.reject(
      new Error(
        'PrescriptionsFacadePort.isVerifiedFor() has no implementation yet — TODO(prescriptions module, owner TBD): bind a real adapter. ' +
          'D-EP09-16: чтение-разрешение без безопасного дефолта, false «изобразил» бы отказ, которого никто не выносил.',
      ),
    )
  }
}

/**
 * **РЕШЕНО (DTJ-242).** `@Global()` — добавлено ЗДЕСЬ, не правкой `payments.module.ts` под
 * `imports: [OrdersModule]`. `HandlePaymentWebhookUseCase`/`OrdersFacadeAdapter` (DTJ-242,
 * `payments`) — ПЕРВЫЙ реальный потребитель `ORDERS_FACADE` за пределами `orders`,
 * предусмотренный ЗАРАНЕЕ (см. JSDoc `OrdersFacade` выше: «единственная точка, через которую
 * ДРУГИЕ модули — payments DTJ-242/244/245/253/254 — читают/меняют заказы»). Буквальный
 * `imports: [OrdersModule]` в `payments.module.ts` дал бы СТАТИЧЕСКИЙ ES-импорт-цикл на уровне
 * файлов: `orders.module.ts` УЖЕ импортирует `PaymentsModule` (строкой выше, DTJ-227/241,
 * `orders → payments`), обратный импорт `payments.module.ts → orders.module.ts` замкнул бы
 * цикл `orders.module.ts → payments.module.ts → orders.module.ts` — тот же класс нарушения,
 * что `dependency-cruiser` (`no-circular`) уже поймал бы у `RetryPaymentUseCase` (см. абзац
 * «РЕШЕНО (DTJ-241)» выше), и `forwardRef()` его НЕ убирает (только DI-резолвинг Nest, не
 * ES-граф импортов, см. тот же абзац). Решение DTJ-241 (перенос кода В `orders`) здесь
 * неприменимо буквально — `HandlePaymentWebhookUseCase` СТРУКТУРНО принадлежит `payments`
 * (SRS-PAY-018: категорический запрет — единственный код, легально вызывающий
 * `markPaidEscrow`/`EscrowLedger.recordHold`, живёт в `payments`, не в `orders`).
 *
 * `@Global()` разрывает цикл БЕЗ единого нового `import`: `payments/infrastructure/adapters/
 * orders-facade.adapter.ts` импортирует ТОЛЬКО `@/modules/orders/index.js` (публичный фасад,
 * `orders.facade.ts`/`payment-invoice.port.ts` — ни один не импортирует `payments` НИ прямо,
 * НИ транзитивно, проверено `grep -rn "modules/payments" src/modules/orders` перед этой
 * правкой — ноль совпадений вне JSDoc-комментариев), НЕ `orders.module.ts` — файл с реальным
 * `imports: [...PaymentsModule]`. `AppModule` уже импортирует ОБА модуля напрямую (корень
 * графа) — `@Global()` лишь снимает требование Nest «провайдер виден только модулям, явно
 * перечислившим поставщика в `imports`» для токенов, УЖЕ являющихся публичным фасадом
 * (`ORDERS_FACADE`/`OrdersFacade`, `exports:` ниже) — не расширяет то, что чужие модули МОГУТ
 * читать, только снимает механическое требование дублировать `imports: [OrdersModule]` в
 * каждом будущем потребителе фасада (EP-11..EP-15 по этому же JSDoc).
 */
@Global()
@Module({
  // CatalogModule/OnboardingModule — DTJ-227: CheckoutUseCase — первый межмодульный DI-потребитель
  // `CATALOG_FACADE`/`OnboardingFacade` за пределами `orders` (оба экспортированы своими модулями).
  // AuthModule — DTJ-226: CartIdentityGuard инжектит JWT_SIGNER (экспортирован auth.module.ts),
  // чтобы верифицировать ОПЦИОНАЛЬНЫЙ Bearer на /api/v1/cart (аутентифицированный customer ИЛИ гость).
  // TenancyModule — DTJ-228/229: `TenancyFacadeAdapter` инжектит TENANT_SETTINGS_REPOSITORY
  // (экспортирован tenancy.module.ts) для `getCodLimitDiram`.
  imports: [CatalogModule, OnboardingModule, AuthModule, TenancyModule, PaymentsModule],
  controllers: [
    CartController,
    CheckoutController,
    RetryPaymentController,
    SystemCancelOrderController,
    PharmacyTerminalQueueController,
    PharmacyTerminalItemsController,
    PartialFulfillmentController,
    PartialFulfillmentTimeoutController,
    CompletePickingController,
    HandoverOtpController,
    PickingSlaBreachController,
  ],
  providers: [
    CART_REPOSITORY_DRIZZLE_PROVIDER,
    CATALOG_FACADE_PORT_PROVIDER,
    INVENTORY_FACADE_PORT_PROVIDER,
    ONBOARDING_FACADE_PORT_PROVIDER,
    CART_HOLD_STORE_REDIS_PROVIDER,
    AddCartItemUseCase,
    UpdateCartItemQuantityUseCase,
    RemoveCartItemUseCase,
    SplitCartByPharmacyUseCase,
    AvailabilityCalculator,
    ExtendCartHoldUseCase,
    GetCartUseCase,
    { provide: ORDER_NUMBER_GENERATOR, useClass: RedisOrderNumberGeneratorAdapter },
    ORDER_REPOSITORY_DRIZZLE_PROVIDER,
    // DTJ-245 — RefundFacadeAdapter (payments-модуль, ре-экспорт `payments/index.js`) заменяет
    // UnimplementedRefundFacadeAdapter (см. JSDoc блока providers выше).
    { provide: REFUND_FACADE_PORT, useExisting: RefundFacadeAdapter },
    { provide: PAYMENT_INVOICE_PORT, useExisting: PaymentInvoiceAdapter },
    ORDERS_UNIT_OF_WORK_DRIZZLE_PROVIDER,
    ORDERS_OUTBOX_DRIZZLE_PROVIDER,
    IDEMPOTENCY_ATTEMPT_ADAPTER_PROVIDER,
    CheckoutUseCase,
    { provide: ORDERS_FACADE, useClass: OrdersFacade },
    OrdersFacade,
    CancelOrderUseCase,
    // DTJ-226 — резолвинг/создание корзины (D-EP09-22) + merge гостевой корзины (SRS-ORD-020).
    CART_IDENTITY_REPOSITORY_DRIZZLE_PROVIDER,
    ResolveOrCreateCartUseCase,
    MergeGuestCartUseCase,
    CartIdentityGuard,
    // DTJ-228/229/230 — расчёт стоимости checkout, снэпшот billing_strategy, адрес/COD/способ
    // оплаты, Rx-исключение (см. JSDoc импортов выше про null-адаптеры DELIVERY_FACADE_PORT/
    // PRESCRIPTIONS_FACADE_PORT).
    TENANCY_FACADE_PORT_PROVIDER,
    USER_ADDRESS_FACADE_PORT_PROVIDER,
    { provide: DELIVERY_FACADE_PORT, useClass: UnimplementedDeliveryFacadeAdapter },
    { provide: PRESCRIPTIONS_FACADE_PORT, useClass: UnimplementedPrescriptionsFacadeAdapter },
    CalculateOrderCostService,
    ResolveBillingStrategyService,
    ResolveDeliveryAddressService,
    ExcludeUnverifiedRxItemsService,
    CodPolicyService,
    PaymentMethodEnabledPolicyService,
    // DTJ-231 — сверка ожидаемой суммы по группам, expectedTotalDiramByPharmacy (см. импорт выше).
    DetectPriceDriftService,
    // DTJ-241 (SRS-PAY-041) — retry-payment (см. JSDoc блока providers, начало файла).
    RetryPaymentUseCase,
    // DTJ-253/254 (EP-10) — SystemCancelOrderUseCase переиспользует ТЕ ЖЕ провайдеры выше
    // (OrdersFacade/INVENTORY_FACADE_PORT/REFUND_FACADE_PORT/CLOCK), новых DI-токенов не требует.
    SystemCancelOrderUseCase,
    InternalServiceGuard,
    // DTJ-301 (EP-12, модуль 24) — очередь/accept/reclaim терминала фармацевта (см. JSDoc импортов выше).
    GetOrderQueueUseCase,
    AcceptOrderUseCase,
    ReclaimOrderUseCase,
    // DTJ-302 (EP-12, терминал фармацевта §A.3, см. JSDoc импортов выше).
    ScanOrderItemUseCase,
    // DTJ-303 (EP-12, терминал фармацевта §A.4, см. JSDoc импортов выше).
    ReportItemIssueUseCase,
    // DTJ-304 (EP-12, терминал фармацевта §A.4, см. JSDoc импортов выше).
    PARTIAL_FULFILLMENT_REQUEST_REPOSITORY_DRIZZLE_PROVIDER,
    PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_PROVIDER,
    ProposePartialFulfillmentUseCase,
    ResolvePartialFulfillmentUseCase,
    // DTJ-305 (EP-12, терминал фармацевта §A.5, см. JSDoc импортов выше).
    CompletePickingUseCase,
    // DTJ-306 (EP-12, терминал фармацевта §A.5, см. JSDoc импортов выше).
    GetHandoverOtpUseCase,
    RegenerateHandoverOtpUseCase,
    // DTJ-307 (EP-12, SLA сборки, см. JSDoc импортов выше).
    ReportPickingSlaBreachUseCase,
    SLA_WATCHDOG_QUEUE_PROVIDER,
    ScheduleSlaWatchdogUseCase,
  ],
  // DTJ-226 (правка приёмки CTO, правило 2 AGENTS.md): без `exports` `OrdersFacade`/
  // `ORDERS_FACADE` были написаны, но физически недостижимы через `imports: [OrdersModule]` —
  // ticket выводит фактический hook в `auth`-flow за периметр DTJ-226, но обязывает сделать
  // `mergeGuestCart` вызываемым («его регистрация в OrdersFacade, если требуется экспорт для
  // вызова из auth»). Оба токена — единственный легальный межмодульный путь (`02-CLEAN-
  // ARCHITECTURE-AND-CODE.md` §1.2), тот же приём, что `exports: [OnboardingFacade]` в
  // `onboarding.module.ts`.
  exports: [ORDERS_FACADE, OrdersFacade],
})
// NestJS module marker class: Nest требует класс-носитель декоратора @Module, providers
// регистрируются декоратором, а не телом класса — правило ниже не ловит реальную проблему,
// только фреймворковую конвенцию (тот же приём, что был в исходном скаффолде DTJ-220).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module marker class, см. комментарий выше
export class OrdersModule {}
