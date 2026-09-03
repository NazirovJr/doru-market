/**
 * NestJS-модуль `payments` (EP-10, DTJ-236). Barrel-файл (D-27): правится ТОЛЬКО добавлением
 * строк, перечитать перед правкой, конфликты слияния — за архитектором.
 *
 * DTJ-236 наполняет `providers`/`controllers` ПУСТЫМИ массивами намеренно — на этом шаге модуль
 * несёт только физический каркас (миграция `0029_payments.sql`, Drizzle-схема, порты к чужим
 * модулям `orders-facade.port.ts`/`tenancy-facade.port.ts`, публичный фасад `index.ts`).
 * Ни одного use case/адаптера этого модуля ещё не существует — биндить нечего. Модуль тем не
 * менее ЗАРЕГИСТРИРОВАН в `AppModule.imports` (см. `app.module.ts`), чтобы «пустой, но
 * подключённый» модуль отличался от «написанного, но неподключённого кода» (правило 2
 * AGENTS.md): `pnpm --filter api build`/DI-резолвинг реального `Nest`-контейнера уже сегодня
 * проверяют, что модуль синтаксически валиден и не порождает циклических импортов, раньше, чем
 * первый провайдер появится и потенциально сломает граф.
 *
 * DTJ-237 (порт `PaymentProvider`/`BankWebhookVerifierPort` + доменные ошибки провайдера) —
 * ЧИСТЫЙ контракт, тоже не требует правки этого файла: `interface`/DI-токен без реализации
 * не резолвится Nest'ом, биндить нечего до первого адаптера (DTJ-238).
 *
 * DTJ-238 (`MockBankProvider`/`MockBankWebhookVerifierAdapter` + dev-эндпоинт) — РЕАЛИЗОВАНО.
 * `MockBankSimulatePaymentController` зарегистрирован БЕЗУСЛОВНО (тот же приём, что
 * `ApiDocsController`/`common/openapi/openapi.module.ts`, SRS-API-061) — доступ гейтуется
 * `MockBankDevAccessGuard` + повторной проверкой внутри обработчика, не отсутствием
 * регистрации маршрута.
 *
 * **DTJ-239 (`AlifMobiProvider`/`DcNextProvider` + верификаторы вебхука) — РЕАЛИЗОВАНО.**
 * `PAYMENT_PROVIDER_TOKEN`/`BANK_WEBHOOK_VERIFIER_PORT` биндятся через `useFactory`, полностью
 * ветвящийся на `AppConfigService.paymentDriver` (SRS-PAY-009) по всем ТРЁМ значениям —
 * `resolvePaymentDriverAdapter()` ниже. До этого тикета любое значение, кроме `'mock_bank'`,
 * бросало на старте процесса (D-EP09-16) — реальных адаптеров не было. Теперь оба реальных
 * адаптера существуют и резолвятся, но остаются ЗАГОТОВКОЙ (R3-включение, SRS-PAY-006): смена
 * `PAYMENT_DRIVER` НЕ включает банковскую оплату для реальных пользователей — см. явное
 * предупреждение у самой функции `resolvePaymentDriverAdapter` ниже (DTJ-239 «Что сделать» п.6).
 *
 * **ВАЖНО, прочитать перед тем как менять `PAYMENT_DRIVER` в проде:** переключение на
 * `'alif_mobi'`/`'dc_next'` в проде физически заблокировано ВТОРЫМ, независимым уровнем
 * защиты — `tenant_settings.enabledPaymentMethods` (`PaymentMethodEnabledPolicyService`,
 * DTJ-229, дефолт R1 для ВСЕХ тенантов — ТОЛЬКО `{'cash_courier'}`), проверяемым
 * `CheckoutUseCase` ДО того, как выбранный `paymentMethod` вообще доходит до этого модуля.
 * Смена ЭТОГО файла/`PAYMENT_DRIVER` НЕ достаточна, чтобы включить реальную оплату —
 * `enabledPaymentMethods` тенанта включается ОТДЕЛЬНЫМ действием (R3).
 *
 * DTJ-240 (`EscrowLedgerEntry`/`EscrowLedger.isBalanced()`/`EscrowLedgerRepository`) —
 * `ESCROW_LEDGER_REPOSITORY` биндится к `DrizzleEscrowLedgerRepository` НАПРЯМУЮ (без
 * ветвления по драйверу — append-only Drizzle-репозиторий не зависит от банковского
 * провайдера). Ни один use case не вызывает его в этом тикете (`CaptureEscrowUseCase`/
 * `RefundOrderUseCase`/`AdjustLedgerUseCase` — DTJ-244..246) — тот же приём, что
 * `MockBankProvider` в DTJ-238 (провайдер резолвится в DI-графе заранее, вызывающий код
 * появится позже).
 *
 * **DTJ-241 (`CreatePaymentInvoiceUseCase`/`PaymentInvoiceAdapter`) — РЕАЛИЗОВАНО.** Замыкает
 * межэпиковый контракт `PaymentInvoicePort` (`orders`, DTJ-220/227, D-EP09-17):
 * `PaymentInvoiceAdapter` заменяет `NullPaymentInvoiceAdapter` в `orders.module.ts` (правка
 * ОДНОЙ строки провайдера там, D-27) — `orders.module.ts` биндит `{ provide:
 * PAYMENT_INVOICE_PORT, useExisting: PaymentInvoiceAdapter }`, для чего этот класс обязан быть
 * ВИДИМ `OrdersModule`, поэтому ЭКСПОРТИРУЕТСЯ ниже (`exports:`) и ре-экспортирован
 * `payments/index.js` (публичный фасад, `02` §1.2 — `orders.module.ts` не имеет права
 * импортировать `infrastructure/**` этого модуля напрямую).
 *
 * **`RetryPaymentUseCase`/`RetryPaymentController` (SRS-PAY-041) намеренно НЕ в этом модуле,
 * вопреки буквальному `files_owned` тикета DTJ-241.** Обоснование — см. DISPUTED в отчёте
 * сдачи: буквальное размещение (`payments/presentation/retry-payment.controller.ts`) требует
 * `RetryPaymentUseCase` читать заказ через `OrdersFacade` (`orders`-модуль), а `orders` УЖЕ
 * зависит от `payments` (`PAYMENT_INVOICE_PORT`, абзац выше) — получилась бы циклическая
 * зависимость МОДУЛЕЙ на уровне ES-импортов (`orders.module.ts` → `payments.module.ts` →
 * `orders.module.ts`), которую `pnpm arch:check` (`dependency-cruiser`, встроенное правило
 * `no-circular`) отклоняет КАК ОШИБКУ — `forwardRef()` решает эту цикличность ТОЛЬКО на уровне
 * DI-резолвинга Nest, не убирает сам статический ES-импорт файлов друг друга, который и ловит
 * гейт. Правило 3 AGENTS.md («не отключай проверку ради зелёного гейта») не оставляет выбора —
 * реализовано вместо этого: `RetryPaymentUseCase` живёт в `orders/application/order-lifecycle/`
 * и вызывает УЖЕ существующий `PAYMENT_INVOICE_PORT` (тот же порт, что `CheckoutUseCase`) —
 * ноль новых зависимостей `orders → payments` сверх уже существующей, ноль зависимостей
 * `payments → orders`, граф остаётся ОДНОНАПРАВЛЕННЫМ.
 *
 * **DTJ-242 (`HandlePaymentWebhookUseCase`/`PaymentsWebhookController`/`OrdersFacadeAdapter`) —
 * РЕАЛИЗОВАНО.** Единственный код-путь, переводящий заказ в `paid_escrow` (SRS-PAY-018).
 * `PAYMENTS_ORDERS_PORT` теперь биндится на КАНОНИЧЕСКИЙ `OrdersFacadeAdapter` (write-capable,
 * поверх `OrdersFacade`) — заменяет временный `OrdersReadOnlyAdapter` (DTJ-248), см. JSDoc
 * `orders-facade.adapter.ts` про снятие DI-цикла через `@Global()` на `OrdersModule`
 * (`orders.module.ts`, а не `imports: [OrdersModule]` здесь — тот же класс проблемы, что
 * `RetryPaymentUseCase`/`OrdersReadOnlyAdapter` уже решали каждый по-своему). Новые порты:
 * `BANK_WEBHOOK_VERIFIER_REGISTRY` (карта provider→verifier поверх УЖЕ существующего
 * `BankWebhookVerifierRegistry`-aggregator'а ниже, не второй граф синглтонов),
 * `PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY` (идемпотентность вебхука, `payment_operations.
 * idempotency_key = bankEventId` — ДРУГОЙ ключ, чем `Idempotency-Key` checkout, SRS-DOM-164),
 * `PAYMENTS_UNIT_OF_WORK`/`PAYMENTS_OUTBOX` (1:1 паттерн `orders`, D-EP09-21 — своя транзакция
 * на вебхук, `markPaidEscrow`+`EscrowLedger.append`+`outbox` атомарны). `main.ts` получил
 * `rawBody: true` (единственная правка бутстрапа, названная риском в самом тикете).
 *
 * **DTJ-245 (`RefundOrderUseCase`/`RefundFacadeAdapter`) — РЕАЛИЗОВАНО.** Замыкает
 * межэпиковый контракт `RefundFacadePort` (`orders`, DTJ-232, D-EP09-28): `RefundFacadeAdapter`
 * заменяет `UnimplementedRefundFacadeAdapter` в `orders.module.ts` (правка ОДНОЙ строки
 * провайдера там, D-27), тот же приём, что `PaymentInvoiceAdapter`/DTJ-241 — экспортируется
 * ниже (`exports:`) для видимости `OrdersModule`. Новый порт `PAYOUT_SCHEDULE_REPOSITORY`
 * (`DrizzlePayoutScheduleRepository`, AC4 DTJ-245 — реверс `payout_schedule` для
 * пост-`delivered` рефанда) биндится напрямую, без ветвления по драйверу — та же логика, что
 * `ESCROW_LEDGER_REPOSITORY` (DTJ-240).
 */
import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { AppConfigService } from '@/config/app-config.service.js'
import {
  MOCK_BANK_AUTO_PAY_QUEUE,
  MOCK_BANK_AUTO_PAY_QUEUE_PROVIDER,
  MockBankProvider,
  type MockBankAutoPayJobData,
} from './infrastructure/adapters/mock-bank.provider.js'
import { MockBankWebhookVerifierAdapter } from './infrastructure/adapters/mock-bank-webhook-verifier.adapter.js'
import { AlifMobiProvider } from './infrastructure/adapters/alif-mobi.provider.js'
import { DcNextProvider } from './infrastructure/adapters/dc-next.provider.js'
import { AlifMobiWebhookVerifierAdapter } from './infrastructure/adapters/alif-mobi-webhook-verifier.adapter.js'
import { DcNextWebhookVerifierAdapter } from './infrastructure/adapters/dc-next-webhook-verifier.adapter.js'
import { PaymentInvoiceAdapter } from './infrastructure/adapters/payment-invoice.adapter.js'
import { MockBankSimulatePaymentController } from './presentation/dev/mock-bank-simulate-payment.controller.js'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProvider } from './application/ports/payment-provider.port.js'
import { BANK_WEBHOOK_VERIFIER_PORT, type BankWebhookVerifierPort } from './application/ports/bank-webhook-verifier.port.js'
import { ESCROW_LEDGER_REPOSITORY } from './application/ports/escrow-ledger-repository.port.js'
import { DrizzleEscrowLedgerRepository } from './infrastructure/repositories/escrow-ledger.repository.js'
import { PAYMENT_INVOICE_CACHE_REPOSITORY_PROVIDER } from './infrastructure/repositories/drizzle-payment-invoice-cache.repository.js'
import { CreatePaymentInvoiceUseCase } from './application/use-cases/create-payment-invoice.use-case.js'
// DTJ-248 — `GET /api/v1/orders/:id/ledger`. `AuthModule` — `AuthGuard`/`RolesGuard` (см. JSDoc
// `get-order-ledger.controller.ts`); односторонний импорт `payments → auth` не создаёт цикла
// (`AuthModule` импортирует только `DatabaseModule`/`RedisModule`, оба `@Global()`).
import { AuthModule } from '@/modules/auth/index.js'
import { PAYMENTS_ORDERS_PORT } from './application/ports/orders-facade.port.js'
import { GetOrderLedgerQuery } from './application/queries/get-order-ledger.query.js'
import { GetOrderLedgerController } from './presentation/ledger/get-order-ledger.controller.js'
// DTJ-242 — HandlePaymentWebhookUseCase/PaymentsWebhookController/OrdersFacadeAdapter (см. JSDoc блока providers).
import { OrdersFacadeAdapter } from './infrastructure/adapters/orders-facade.adapter.js'
import {
  BANK_WEBHOOK_VERIFIER_REGISTRY,
  type BankWebhookVerifierRegistryPort,
} from './application/ports/bank-webhook-verifier-registry.port.js'
import { PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY_PROVIDER } from './infrastructure/repositories/drizzle-payment-webhook-operations.repository.js'
import { PAYMENTS_UNIT_OF_WORK_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-payments-unit-of-work.adapter.js'
import { PAYMENTS_OUTBOX_DRIZZLE_PROVIDER } from './infrastructure/adapters/drizzle-payments-outbox.adapter.js'
import { HandlePaymentWebhookUseCase } from './application/use-cases/handle-payment-webhook.use-case.js'
import { PaymentsWebhookController } from './presentation/webhook/payments-webhook.controller.js'
// DTJ-245 — RefundOrderUseCase/RefundFacadeAdapter (см. JSDoc блока providers выше).
import { PAYOUT_SCHEDULE_REPOSITORY_PROVIDER } from './infrastructure/repositories/payout-schedule.repository.js'
import { RefundOrderUseCase } from './application/use-cases/refund-order.use-case.js'
import { RefundFacadeAdapter } from './infrastructure/adapters/refund-facade.adapter.js'
// DTJ-243 — AuditLogPort/SupportTicketPort (сырой SQL, см. JSDoc адаптеров про DISPUTED
// отношение к DTJ-270) + LatePaymentRefundService, оба потребляются HandlePaymentWebhookUseCase.
import { AUDIT_LOG_PORT_PROVIDER } from './infrastructure/repositories/raw-sql-audit-log.repository.js'
import { SUPPORT_TICKET_PORT_PROVIDER } from './infrastructure/repositories/raw-sql-support-ticket.repository.js'
import { LatePaymentRefundService } from './application/services/late-payment-refund.service.js'
// DTJ-244 — CaptureEscrowUseCase/OrderDeliveredSubscriber (см. JSDoc блока providers выше).
// TenancyModule — PaymentsTenancyAdapter инжектит TENANT_SETTINGS_REPOSITORY (holdPeriodDays).
import { TenancyModule } from '@/modules/tenancy/tenancy.module.js'
import { PROCESSED_EVENTS_PORT_PROVIDER } from './infrastructure/repositories/drizzle-processed-events.repository.js'
import { PAYMENTS_TENANCY_PORT_PROVIDER } from './infrastructure/adapters/payments-tenancy.adapter.js'
import { CaptureEscrowUseCase } from './application/use-cases/capture-escrow.use-case.js'
import { OrderDeliveredSubscriber } from './infrastructure/subscribers/order-delivered.subscriber.js'
import { PaymentsInternalServiceGuard } from './presentation/internal/payments-internal-service.guard.js'
import { OrderDeliveredController } from './presentation/internal/order-delivered.controller.js'

type PaymentDriver = 'mock_bank' | 'alif_mobi' | 'dc_next'

/**
 * DTJ-239 (SRS-PAY-009) — переключатель адаптера НА УРОВНЕ DI, не влияет на `application`/
 * `domain` код (Provider Pattern, Charter §3.3). **Не путать со включением реальной оплаты для
 * пользователя** — см. JSDoc файла «ВАЖНО, прочитать перед тем как менять PAYMENT_DRIVER в
 * проде»: этот резолвер лишь выбирает КЛАСС адаптера, реальный приём платежа блокируется
 * `tenant_settings.enabledPaymentMethods`, не этой функцией.
 */
function resolvePaymentDriverAdapter<T>(driver: PaymentDriver, adapters: Readonly<Record<PaymentDriver, T>>): T {
  return adapters[driver]
}

/**
 * Агрегирует три конкретных `PaymentProvider`-адаптера в ОДИН инжектируемый параметр —
 * иначе `useFactory` ниже нёс бы 4 параметра (3 адаптера + `AppConfigService`), нарушая
 * `max-params` ≤3 (C5). Чисто механическая обвязка DI, без логики.
 */
@Injectable()
class PaymentProviderRegistry {
  public constructor(
    @Inject(MockBankProvider) public readonly mockBank: MockBankProvider,
    @Inject(AlifMobiProvider) public readonly alifMobi: AlifMobiProvider,
    @Inject(DcNextProvider) public readonly dcNext: DcNextProvider,
  ) {}
}

/** Симметрично `PaymentProviderRegistry`, для `BankWebhookVerifierPort`-адаптеров. */
@Injectable()
class BankWebhookVerifierRegistry {
  public constructor(
    @Inject(MockBankWebhookVerifierAdapter) public readonly mockBank: MockBankWebhookVerifierAdapter,
    @Inject(AlifMobiWebhookVerifierAdapter) public readonly alifMobi: AlifMobiWebhookVerifierAdapter,
    @Inject(DcNextWebhookVerifierAdapter) public readonly dcNext: DcNextWebhookVerifierAdapter,
  ) {}
}

/**
 * DTJ-242 — «карта provider → verifier» (SRS-PAY-019), см. JSDoc `bank-webhook-verifier-
 * registry.port.ts`: ОТДЕЛЬНО от `BANK_WEBHOOK_VERIFIER_PORT` (единственный АКТИВНЫЙ
 * провайдер по `config.paymentDriver`, п.выше) — входящий вебхук резолвится по заголовку
 * `X-Payment-Provider`, независимо от текущего `PAYMENT_DRIVER`. Переиспользует ТОТ ЖЕ
 * `BankWebhookVerifierRegistry`-агрегатор (тот же граф синглтонов), не второй набор `@Inject()`.
 */
function resolveBankWebhookVerifier(registry: BankWebhookVerifierRegistry, providerName: string): BankWebhookVerifierPort | null {
  if (providerName === 'mock_bank') return registry.mockBank
  if (providerName === 'alif_mobi') return registry.alifMobi
  if (providerName === 'dc_next') return registry.dcNext
  return null
}

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [
    MockBankSimulatePaymentController,
    GetOrderLedgerController,
    PaymentsWebhookController,
    OrderDeliveredController,
  ],
  providers: [
    MOCK_BANK_AUTO_PAY_QUEUE_PROVIDER,
    MockBankProvider,
    MockBankWebhookVerifierAdapter,
    AlifMobiProvider,
    DcNextProvider,
    AlifMobiWebhookVerifierAdapter,
    DcNextWebhookVerifierAdapter,
    PaymentProviderRegistry,
    BankWebhookVerifierRegistry,
    {
      provide: PAYMENT_PROVIDER_TOKEN,
      useFactory: (registry: PaymentProviderRegistry, config: AppConfigService): PaymentProvider =>
        resolvePaymentDriverAdapter<PaymentProvider>(config.paymentDriver, {
          mock_bank: registry.mockBank,
          alif_mobi: registry.alifMobi,
          dc_next: registry.dcNext,
        }),
      inject: [PaymentProviderRegistry, AppConfigService],
    },
    {
      provide: BANK_WEBHOOK_VERIFIER_PORT,
      useFactory: (registry: BankWebhookVerifierRegistry, config: AppConfigService): BankWebhookVerifierPort =>
        resolvePaymentDriverAdapter<BankWebhookVerifierPort>(config.paymentDriver, {
          mock_bank: registry.mockBank,
          alif_mobi: registry.alifMobi,
          dc_next: registry.dcNext,
        }),
      inject: [BankWebhookVerifierRegistry, AppConfigService],
    },
    {
      provide: BANK_WEBHOOK_VERIFIER_REGISTRY,
      useFactory: (registry: BankWebhookVerifierRegistry): BankWebhookVerifierRegistryPort => ({
        resolve: (providerName: string) => resolveBankWebhookVerifier(registry, providerName),
      }),
      inject: [BankWebhookVerifierRegistry],
    },
    { provide: ESCROW_LEDGER_REPOSITORY, useClass: DrizzleEscrowLedgerRepository },
    PAYMENT_INVOICE_CACHE_REPOSITORY_PROVIDER,
    CreatePaymentInvoiceUseCase,
    PaymentInvoiceAdapter,
    // DTJ-242 — идемпотентность/UoW/outbox вебхука (см. JSDoc блока providers выше).
    PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY_PROVIDER,
    PAYMENTS_UNIT_OF_WORK_DRIZZLE_PROVIDER,
    PAYMENTS_OUTBOX_DRIZZLE_PROVIDER,
    OrdersFacadeAdapter,
    HandlePaymentWebhookUseCase,
    // DTJ-242 — заменяет временный `OrdersReadOnlyAdapter` (DTJ-248, `getOrderById`-only обход
    // того же DI-цикла, см. её JSDoc «Канонический write-capable OrdersFacadeAdapter (DTJ-242)
    // при приземлении обязан заменить ЭТУ строку») КАНОНИЧЕСКИМ write-capable адаптером —
    // `getOrderById`/`markPaidEscrow`/`cancel` теперь реализованы поверх реального `OrdersFacade`
    // (см. JSDoc `orders-facade.adapter.ts`). `OrdersReadOnlyAdapter` остаётся в дереве исходников
    // неиспользуемым — файл вне периметра DTJ-242 (`infrastructure/adapters/orders-read-only.
    // adapter.ts`, владение DTJ-248), не удаляется этим тикетом, см. отчёт сдачи, раздел
    // «НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ».
    { provide: PAYMENTS_ORDERS_PORT, useClass: OrdersFacadeAdapter },
    GetOrderLedgerQuery,
    // DTJ-245 — рефанд (см. JSDoc блока providers выше).
    PAYOUT_SCHEDULE_REPOSITORY_PROVIDER,
    RefundOrderUseCase,
    RefundFacadeAdapter,
    // DTJ-243 — пограничные случаи вебхука (см. JSDoc блока providers выше).
    AUDIT_LOG_PORT_PROVIDER,
    SUPPORT_TICKET_PORT_PROVIDER,
    LatePaymentRefundService,
    // DTJ-244 — захват комиссии/выплаты при доставке (см. JSDoc блока providers выше).
    PROCESSED_EVENTS_PORT_PROVIDER,
    PAYMENTS_TENANCY_PORT_PROVIDER,
    CaptureEscrowUseCase,
    OrderDeliveredSubscriber,
    PaymentsInternalServiceGuard,
  ],
  exports: [PaymentInvoiceAdapter, RefundFacadeAdapter],
})
export class PaymentsModule implements OnModuleDestroy {
  public constructor(@Inject(MOCK_BANK_AUTO_PAY_QUEUE) private readonly autoPayQueue: Queue<MockBankAutoPayJobData>) {}

  public async onModuleDestroy(): Promise<void> {
    await this.autoPayQueue.close()
  }
}
