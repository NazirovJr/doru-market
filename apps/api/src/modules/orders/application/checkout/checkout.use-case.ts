/**
 * `CheckoutUseCase` (EP-09, DTJ-227/228/229/230/231) — ЕДИНСТВЕННЫЙ публичный use case для
 * `POST /api/v1/orders` (SRS-ORD-017..020, SRS-DOM-166, SRS-API-009/010). Сплит корзины на N
 * групп по аптекам, атомарная обработка КАЖДОЙ группы в СВОЕЙ транзакции (`OrdersUnitOfWorkPort`,
 * D-EP09-21), композитный ответ с частичным успехом.
 *
 * **Синхронный `PaymentInvoicePort.createInvoice` ПОСЛЕ commit (D-EP09-17, решение CTO,
 * закрыто).** Компромисс между SRS-ORD-018 (вызов после commit) и SRS-DOM-166 (синхронный
 * `503` клиенту): таймаут/ошибка `createInvoice` НЕ откатывает уже закоммиченный заказ — он
 * остаётся в `pending_payment` без `paymentTransactionId`, группа отвечает
 * `paymentPending: true`. `cash_courier` НИКОГДА не вызывает `createInvoice` (D-25).
 *
 * **Подключение DTJ-228/229/230 (эта правка).** Шаги 4a/4b(частично)/4d/4e/4f, оставленные
 * DTJ-227 заглушками (`TODO(DTJ-228/229/230)`), теперь подключены:
 *   - DTJ-228: `CalculateOrderCostService` резолвит `commissionBps`/`platformFeeDiram` НА
 *     КАЖДУЮ позицию + `deliveryFeeDiram` ДО `Order.create()` (заменяет `ZERO_COMMISSION_BPS`/
 *     `deliveryFee=0` заглушки); `ResolveBillingStrategyService` снэпшотит `billingStrategy`.
 *   - DTJ-229: `ResolveDeliveryAddressService` заменяет свободную функцию `resolveDeliveryAddress`
 *     (`checkout.util.ts`) — теперь резолвит И сохранённый адрес (`UserAddressFacadePort`), не
 *     только инлайн; `PaymentMethodEnabledPolicyService`/`CodPolicyService` — РАННИЕ проверки
 *     ДО транзакции группы (whole-checkout-level 422, не похоронены в `failedGroups`).
 *   - DTJ-230: `ExcludeUnverifiedRxItemsService` — Rx-исключение шагом ПЕРВЫМ (ДО расчёта
 *     стоимости); `assertOrderConfirmationInvariant` — явная D-25 assertion сразу после
 *     `Order.create()` (`InvariantViolationError`, НЕ доменная ошибка, D-EP09-35).
 * `Order.create()` (DTJ-221) остаётся финальным рубежом инвариантов
 * (`order-create.validators.ts`) независимо от РАННИХ, точных по коду ошибок этой правки.
 *
 * **Подключение DTJ-231 (SRS-ORD-023, гонки/дрейф цены/двойной клик).**
 * `DetectPriceDriftService.check()` вызывается в `createAndSaveOrder` ПОСЛЕ
 * `CalculateOrderCostService.calculate()`, ДО `Order.create()` — расхождение откатывает ТОЛЬКО
 * текущую группу (`PriceOrStockChangedError`, обычная `DomainError`, ловится существующей
 * catch-веткой `processGroup`). Одновременно эта правка
 * чинит `runCheckout`: проверка «нечего оформлять» (`NoOrderableItemsError`, SRS-ORD-016) теперь
 * смотрит на `groups.length` (ничего не исключалось до сплита по аптекам), а не на
 * `orders.length` — старая проверка ложно ловила и сценарий «группы БЫЛИ, но каждая провалилась
 * своей ошибкой» (например, `PriceOrStockChangedError`/`InsufficientStockError` на ВСЕ группы),
 * для которого SRS-ORD-019/DTJ-233 AC4 требуют композитный `200` с пустым `orders` и непустым
 * `failedGroups`, а не `422`, прячущий `failedGroups` целиком (foundIssue, зафиксировано в отчёте
 * сдачи DTJ-231). Двойной клик/конкурентный дубль (`Idempotency-Key`/`checkout_attempt_id`) и
 * гонка за последнюю единицу товара уже покрыты существующим механизмом `execute()` (идемпотентность
 * попытки, DTJ-227) и `InventoryFacadeAdapter.reserveStock` (`SELECT ... FOR UPDATE`, DTJ-227) —
 * DTJ-231 добавляет им явные тесты РЕАЛЬНОЙ конкурентности (`test/integration/orders/`), без
 * изменения кода этих путей.
 *
 * **Дефект (найден при сдаче DTJ-231/233, исправлено этой правкой) — self-deadlock пула
 * соединений.** `processGroup` вызывал `catalogFacade.getMedicineSnapshot` ВНУТРИ
 * `unitOfWork.run` — второе соединение пула поверх уже открытой транзакции группы (см. JSDoc
 * `processGroup` ниже, подробности причины/доказательство). При конкурентности групп ≥
 * `DEFAULT_POOL_MAX` пул исчерпывался навсегда (не «медленно»), что и воспроизводил
 * нагрузочный тест `checkout-race-conditions.integration.spec.ts` (был `it.skip` с разбором
 * причины, теперь включён и проходит). Исправление: снимок каталога читается ДО открытия `tx`
 * группы — поведение (частичный успех групп, дрейф цены, идемпотентность, D-25) не менялось.
 *
 * **Поправка CTO (волна 6, SRS-ORD-023) — исправление дрейфа цены при мультиаптечной корзине.**
 * `cmd.expectedTotalDiram` (одно число на весь запрос, DTJ-231) переименован в
 * `cmd.expectedTotalDiramByPharmacy` (ключ — `pharmacyId`, `checkout-command.dto.ts`) —
 * `createAndSaveOrder` резолвит запись ИМЕННО текущей группы ПЕРЕД вызовом `check()`. До этой
 * правки `check()` уже вызывался НА ГРУППУ, но сверял её с ОДНИМ общим числом — при корзине из
 * двух и более аптек (главный сценарий продукта) любое переданное значение совпадало максимум с
 * одной группой и давало ложный `PRICE_OR_STOCK_CHANGED` всем остальным, то есть защита не
 * работала ни в каком виде (дефект независимо обнаружили DTJ-231 и DTJ-235, см. JSDoc
 * `DetectPriceDriftService`). Заодно сравнение переведено на `cost.itemsTotalDiram` (сумма
 * позиций) вместо `cost.totalAmountDiram` (позиции + доставка) — доставку считает сервер,
 * клиент её на момент подтверждения не знает, сверка с ней была невыполнима по построению.
 *
 * `execute()`/`runCheckout()` ≤40 строк (C1) — декомпозированы на приватные шаги ниже.
 */
import { Inject, Injectable } from '@nestjs/common'
import { DomainError, NoOrderableItemsError, ForbiddenError, type BillingStrategy } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { ORDER_NUMBER_GENERATOR, type OrderNumberGeneratorPort } from '@/shared-kernel/application/ports/order-number-generator.port.js'
import { CART_REPOSITORY, type CartItemRecord, type CartRepository } from '@/modules/orders/application/cart/ports/cart.repository.port.js'
import { SplitCartByPharmacyUseCase, type PharmacyGroup, type PricedCartLineItem } from '@/modules/orders/application/cart/split-cart-by-pharmacy.use-case.js'
import { CATALOG_FACADE_PORT, type CatalogFacadePort, type MedicineOrderSnapshot } from '@/modules/orders/application/ports/catalog-facade.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '@/modules/orders/application/ports/onboarding-facade.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort, type ReservedStockLine } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { PAYMENT_INVOICE_PORT, type PaymentInvoicePort } from '@/modules/orders/application/ports/payment-invoice.port.js'
import { TENANCY_FACADE_PORT, type TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { ORDER_REPOSITORY_PORT, type OrderRepositoryPort, type OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { ORDERS_OUTBOX, type OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import {
  IDEMPOTENCY_ATTEMPT_ADAPTER,
  type IdempotencyAttemptAdapter,
} from '@/modules/orders/application/ports/idempotency-attempt.port.js'
import type { OrderCreateCommand } from '@/modules/orders/domain/order-create-command.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { CalculateOrderCostService } from './calculate-order-cost.service.js'
import { ResolveBillingStrategyService } from './resolve-billing-strategy.service.js'
import { ResolveDeliveryAddressService } from './resolve-delivery-address.service.js'
import { ExcludeUnverifiedRxItemsService } from './exclude-unverified-rx-items.service.js'
import { CodPolicyService } from '@/modules/orders/application/policies/cod-policy.service.js'
import { PaymentMethodEnabledPolicyService } from '@/modules/orders/application/policies/payment-method-enabled-policy.service.js'
import { PaymentMethodNotEnabledError } from './errors/payment-method-not-enabled.error.js'
import { DetectPriceDriftService } from './detect-price-drift.service.js'
import type { CheckoutCommand } from './dto/checkout-command.dto.js'
import type { CheckoutExcludedItemDto, CheckoutOrderResultDto, CheckoutResultDto } from './dto/checkout-result.dto.js'
import {
  assertOrderConfirmationInvariant,
  buildCodPolicyInput,
  buildCostInputItems,
  buildItemCommands,
  buildOrderCreateCommand,
  collectFailedGroups,
  toDushanbeYYMMDD,
  toRxCheckItems,
  withTimeout,
  type GroupOutcome,
  type ResolvedAddress,
} from './checkout.util.js'

const PHARMACY_SUSPENDED_REASON = 'PHARMACY_SUSPENDED'
const ZERO_DIRAM = 0n

/** Объект-параметр `processGroup` (C5, `max-params` ≤3) — весь контекст ОДНОЙ группы. */
interface ProcessGroupInput {
  readonly group: PharmacyGroup
  readonly cmd: CheckoutCommand
  readonly address: ResolvedAddress
  readonly billingStrategy: BillingStrategy
  readonly codLimitDiram: bigint
}

/** Объект-параметр `createAndSaveOrder` (C5, `max-params` ≤3) — весь контекст ОДНОЙ группы + результат резерва. */
interface CreateOrderInput extends ProcessGroupInput {
  readonly snapshots: ReadonlyMap<string, MedicineOrderSnapshot>
  readonly reservedLines: readonly ReservedStockLine[]
  readonly tx: OrderUnitOfWorkTx
}

@Injectable()
export class CheckoutUseCase {
  // 22 зависимости (DTJ-231 добавил DetectPriceDriftService) — центральный оркестратор эпика,
  // собирающий воедино ВСЕ порты DTJ-220 +
  // все application-сервисы DTJ-228/229/230 + идемпотентность + UoW + outbox (см. JSDoc
  // файла). Тот же приём, что `GetCartUseCase`/`AddCartItemUseCase` (explicit @Inject на
  // каждом параметре сохраняет граф зависимостей видимым в providers[] модуля, а не скрывает
  // его за анонимной фабрикой), только с бОльшим числом портов — это и есть единственное
  // место, где ВСЕ они сходятся.
  // eslint-disable-next-line max-params -- см. комментарий выше, C5 недостижим без сокрытия графа зависимостей за фабрикой
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacade: CatalogFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(PAYMENT_INVOICE_PORT) private readonly paymentInvoice: PaymentInvoicePort,
    @Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort,
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(ORDERS_OUTBOX) private readonly ordersOutbox: OrdersOutboxPort,
    @Inject(ORDER_NUMBER_GENERATOR) private readonly orderNumberGenerator: OrderNumberGeneratorPort,
    @Inject(SplitCartByPharmacyUseCase) private readonly splitCartByPharmacy: SplitCartByPharmacyUseCase,
    @Inject(IDEMPOTENCY_ATTEMPT_ADAPTER) private readonly idempotency: IdempotencyAttemptAdapter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(CalculateOrderCostService) private readonly calculateOrderCost: CalculateOrderCostService,
    @Inject(ResolveBillingStrategyService) private readonly resolveBillingStrategy: ResolveBillingStrategyService,
    @Inject(ResolveDeliveryAddressService) private readonly resolveDeliveryAddress: ResolveDeliveryAddressService,
    @Inject(ExcludeUnverifiedRxItemsService) private readonly excludeUnverifiedRx: ExcludeUnverifiedRxItemsService,
    @Inject(CodPolicyService) private readonly codPolicy: CodPolicyService,
    @Inject(PaymentMethodEnabledPolicyService) private readonly paymentMethodEnabledPolicy: PaymentMethodEnabledPolicyService,
    // DTJ-231 (SRS-ORD-023), поправка CTO волна 6 — сверка ПО ГРУППЕ (`expectedTotalDiramByPharmacy`)
    // с суммой ПОЗИЦИЙ, ПОСЛЕ `CalculateOrderCostService`, ДО `Order.create()` (см. вызов в
    // `createAndSaveOrder`).
    @Inject(DetectPriceDriftService) private readonly detectPriceDrift: DetectPriceDriftService,
  ) {}

  async execute(cmd: CheckoutCommand): Promise<CheckoutResultDto> {
    const cached = await this.idempotency.findCompleted(cmd.customerId, cmd.checkoutAttemptId, cmd)
    if (cached !== null) {
      return cached
    }
    const attemptId = await this.idempotency.begin(cmd.customerId, cmd.checkoutAttemptId, cmd)
    try {
      const result = await this.runCheckout(cmd)
      await this.idempotency.complete(attemptId, result)
      return result
    } catch (error) {
      await this.idempotency.release(attemptId)
      throw error
    }
  }

  private async runCheckout(cmd: CheckoutCommand): Promise<CheckoutResultDto> {
    await this.assertPaymentMethodEnabled(cmd)
    const address = await this.resolveDeliveryAddress.resolve(cmd)
    const billingStrategy = this.resolveBillingStrategy.resolve(cmd.tenantId, cmd.paymentMethod)
    const codLimitDiram = await this.tenancyFacade.getCodLimitDiram(cmd.tenantId)
    const ownedItems = await this.loadOwnedCartItems(cmd)
    const { activeItems, excludedItems: suspendedExclusions } = await this.excludeInactivePharmacies(ownedItems)
    const snapshots = await this.loadSnapshots(activeItems)
    const { orderableItems, excludedItems: rxExclusions } = await this.excludeUnverifiedRxItems(activeItems, snapshots, cmd)
    const excludedItems = [...suspendedExclusions, ...rxExclusions]
    await this.assertCodPolicyIfCash(cmd, orderableItems, snapshots)
    const groups = await this.buildPharmacyGroups(orderableItems, snapshots)
    // SRS-ORD-016 — «ни одной группы для оформления»: проверяется на GROUPS (нечего было даже
    // ПОПРОБОВАТЬ оформить — вся корзина исключена приостановкой/Rx ДО сплита по аптекам), а не
    // на итоговом `orders.length` (DTJ-231, foundIssue). Прежняя проверка `orders.length === 0`
    // ложно ловила и сценарий «группы БЫЛИ, но каждая провалилась своей доменной ошибкой»
    // (например, `PriceOrStockChangedError`/`InsufficientStockError` на ВСЕ группы разом) —
    // тогда правильный ответ композитный `200` с пустым `orders`/непустым `failedGroups`
    // (SRS-ORD-019, DTJ-233 AC4), а не `422 NO_ORDERABLE_ITEMS`, скрывающий failedGroups целиком.
    if (groups.length === 0) {
      throw new NoOrderableItemsError({ checkoutAttemptId: cmd.checkoutAttemptId, excludedItemsCount: excludedItems.length, failedGroupsCount: 0 })
    }
    const outcomes = await Promise.all(
      groups.map((group) => this.processGroup({ group, cmd, address, billingStrategy, codLimitDiram })),
    )
    const orders = await this.finalizeCreatedOrders(outcomes, cmd)
    const failedGroups = collectFailedGroups(outcomes)
    return { orders, failedGroups, meta: { excludedItems } }
  }

  /** DTJ-229 — структурная/config-проверка, не зависит от корзины: РАНЬШЕ загрузки cart_items. */
  private async assertPaymentMethodEnabled(cmd: CheckoutCommand): Promise<void> {
    const enabled = await this.paymentMethodEnabledPolicy.isEnabled(cmd.paymentMethod, cmd.tenantId)
    if (!enabled) {
      throw new PaymentMethodNotEnabledError({ paymentMethod: cmd.paymentMethod, tenantId: cmd.tenantId })
    }
  }

  /** Ownership: `cartItemIds` обязаны существовать И принадлежать `cmd.customerId` (403, «Что сделать» п.2.1). */
  private async loadOwnedCartItems(cmd: CheckoutCommand): Promise<readonly CartItemRecord[]> {
    const items = await this.cartRepository.findItemsByIds(cmd.tenantId, cmd.cartItemIds)
    if (items.length !== cmd.cartItemIds.length) {
      throw new ForbiddenError('One or more cart items do not exist for this tenant', { checkoutAttemptId: cmd.checkoutAttemptId })
    }
    const cartIds = [...new Set(items.map((item) => item.cartId))]
    const carts = await Promise.all(cartIds.map((cartId) => this.cartRepository.findById(cmd.tenantId, cartId)))
    const ownedCartIds = new Set(carts.filter((cart) => cart?.customerId === cmd.customerId).map((cart) => cart?.id))
    if (ownedCartIds.size !== cartIds.length) {
      throw new ForbiddenError('Cart items do not belong to the requesting customer', { checkoutAttemptId: cmd.checkoutAttemptId })
    }
    return items
  }

  /** SRS-ORD-018 шаг 2 / SRS-ORD-041 — единая точка проверки приостановки, батч по уникальной аптеке. */
  private async excludeInactivePharmacies(
    items: readonly CartItemRecord[],
  ): Promise<{ activeItems: readonly CartItemRecord[]; excludedItems: readonly CheckoutExcludedItemDto[] }> {
    const pharmacyIds = [...new Set(items.map((item) => item.pharmacyId))]
    const activeFlags = new Map(
      await Promise.all(pharmacyIds.map(async (id) => [id, await this.onboardingFacade.isPharmacyActive(id)] as const)),
    )
    const activeItems = items.filter((item) => activeFlags.get(item.pharmacyId) === true)
    const excludedItems = items
      .filter((item) => activeFlags.get(item.pharmacyId) !== true)
      .map((item) => ({ cartItemId: item.id, reason: PHARMACY_SUSPENDED_REASON }))
    return { activeItems, excludedItems }
  }

  /** Один batch-запрос каталога, переиспользуется Rx-исключением (DTJ-230) И группировкой ниже — без N+1/дублей. */
  private async loadSnapshots(items: readonly CartItemRecord[]): Promise<ReadonlyMap<string, MedicineOrderSnapshot>> {
    if (items.length === 0) return new Map()
    const medicineIds = [...new Set(items.map((item) => item.medicineId))]
    return this.catalogFacade.getMedicineSnapshot(medicineIds)
  }

  /** SRS-ORD-018 шаг 4a (DTJ-230) — Rx-исключение ДО расчёта стоимости; ОДИН вызов порта на весь набор. */
  private async excludeUnverifiedRxItems(
    items: readonly CartItemRecord[],
    snapshots: ReadonlyMap<string, MedicineOrderSnapshot>,
    cmd: CheckoutCommand,
  ): Promise<{ orderableItems: readonly CartItemRecord[]; excludedItems: readonly CheckoutExcludedItemDto[] }> {
    const { orderable, excluded } = await this.excludeUnverifiedRx.exclude(
      toRxCheckItems(items, snapshots),
      cmd.prescriptionIds,
      cmd.customerId,
    )
    const orderableIds = new Set(orderable.map((item) => item.cartItemId))
    return {
      orderableItems: items.filter((item) => orderableIds.has(item.id)),
      excludedItems: excluded.map((item) => ({ cartItemId: item.cartItemId, reason: item.reason })),
    }
  }

  /**
   * DTJ-229 — РАННЯЯ проверка ДО транзакции группы (whole-checkout-level 422, `CodPolicyService`
   * JSDoc): агрегат ПО ВСЕМ заказываемым позициям (после Rx-исключения), приблизительная сумма
   * без доставки (доставка сейчас всегда `0`, известный пробел `CalculateOrderCostService`
   * JSDoc — `pharmacyGeoPoint` структурно недоступен, см. `OnboardingFacadePort`) — домен
   * (`validateCodEligibility`) остаётся точным последним рубежом НА КАЖДУЮ группу отдельно.
   */
  private async assertCodPolicyIfCash(
    cmd: CheckoutCommand,
    items: readonly CartItemRecord[],
    snapshots: ReadonlyMap<string, MedicineOrderSnapshot>,
  ): Promise<void> {
    if (cmd.paymentMethod !== 'cash_courier' || items.length === 0) {
      return
    }
    const { codItems, totalAmountDiram } = buildCodPolicyInput(items, snapshots)
    await this.codPolicy.isCodAllowed(codItems, totalAmountDiram, cmd.tenantId)
  }

  /** SRS-ORD-018 шаг 3 — `SplitCartByPharmacyUseCase` (DTJ-223), переиспользован, не продублирован (DoD DTJ-223 №4). */
  private async buildPharmacyGroups(
    items: readonly CartItemRecord[],
    snapshots: ReadonlyMap<string, MedicineOrderSnapshot>,
  ): Promise<readonly PharmacyGroup[]> {
    if (items.length === 0) return []
    const pharmacyIds = [...new Set(items.map((item) => item.pharmacyId))]
    const names = await this.onboardingFacade.getPharmacyNames(pharmacyIds)
    const pricedLines: PricedCartLineItem[] = items.map((item) => ({
      medicineId: item.medicineId,
      pharmacyId: item.pharmacyId,
      pharmacyName: names.get(item.pharmacyId) ?? null,
      quantity: item.quantity,
      unitPriceDiram: snapshots.get(item.medicineId)?.unitPriceDiram ?? ZERO_DIRAM,
    }))
    return this.splitCartByPharmacy.execute(pricedLines)
  }

  /**
   * СВОЯ транзакция НА ГРУППУ (SRS-ORD-019, DoD тикета) — провал одной аптеки не откатывает
   * уже закоммиченную другую. `reserveStock`/`Order.create()`/`save()` — на переданном `tx`.
   * Доменная ошибка внутри транзакции брошена намеренно (не `Result`) — откатывает ЭТУ
   * транзакцию целиком (резерв остатка включительно), ловится СНАРУЖИ `unitOfWork.run`.
   *
   * **Дефект (найден при сдаче DTJ-231/233, self-deadlock пула соединений, исправлено
   * здесь).** `getMedicineSnapshot` — ПЕРЕД `unitOfWork.run`, НЕ внутри него. Причина:
   * `unitOfWork.run` держит ОДНО соединение пула на всю транзакцию группы;
   * `CatalogFacadeAdapter.getMedicineSnapshot` ходит через СВОЙ `@Inject(DRIZZLE_DB)` (порт
   * `getMedicineSnapshot(medicineIds)` не принимает `tx` — межмодульный фасад `catalog`,
   * втягивать его в транзакцию `orders` неверно архитектурно) — вызов ВНУТРИ `tx` просил бы у
   * ТОГО ЖЕ пула ВТОРОЕ соединение, не отдавая первое. `groups.map(...)` в `runCheckout`
   * обрабатывает группы конкурентно — при конкурентности ≥ `DEFAULT_POOL_MAX`
   * (`infrastructure/database/drizzle.provider.ts`) каждая группа держит своё единственное
   * соединение под `tx` и одновременно просит второе — пул исчерпан навсегда (не «медленно»),
   * воспроизведено `test/integration/orders/checkout-race-conditions.integration.spec.ts`
   * (нагрузочный тест, 50 групп/пул 10) через `pg_stat_activity`: все соединения пула
   * `idle in transaction`/`query='begin'`/`wait_event=ClientRead`, `pg_locks` пуст — то есть
   * это НЕ конкуренция за блокировку строки. Снимок каталога здесь — чтение справочных
   * данных (Rx/`controlCategory` метаданные для `buildItemCommands`/`buildCostInputItems`),
   * НЕ принадлежит транзакционной границе заказа: authoritative-цена позиции всё равно берётся
   * из `reserveResult.value` (`InventoryFacadePort.reserveStock`, race-free лот) ниже, не
   * отсюда (см. JSDoc `buildItemCommands`). Вынос ДО `tx` не меняет свежесть данных
   * (запрашивается непосредственно перед открытием транзакции той же группы, как и раньше).
   */
  private async processGroup(input: ProcessGroupInput): Promise<GroupOutcome> {
    const { group } = input
    try {
      const snapshots = await this.catalogFacade.getMedicineSnapshot(group.items.map((item) => item.medicineId))
      return await this.unitOfWork.run<GroupOutcome>(async (tx) => {
        const reserveResult = await this.inventoryFacade.reserveStock(
          group.pharmacyId,
          group.items.map((item) => ({ medicineId: item.medicineId, quantity: item.quantity })),
          tx,
        )
        if (!reserveResult.ok) {
          return {
            kind: 'failed',
            pharmacyId: group.pharmacyId,
            reason: reserveResult.error.code,
            details: { medicineId: reserveResult.error.medicineId },
          }
        }
        const order = await this.createAndSaveOrder({ ...input, snapshots, reservedLines: reserveResult.value, tx })
        return { kind: 'created', order }
      })
    } catch (error) {
      if (error instanceof DomainError) {
        return { kind: 'failed', pharmacyId: group.pharmacyId, reason: error.code, details: error.details }
      }
      throw error
    }
  }

  private async createAndSaveOrder(input: CreateOrderInput): Promise<Order> {
    const { group, cmd, address, billingStrategy, codLimitDiram, snapshots, reservedLines, tx } = input
    const now = this.clock.now()
    const cost = await this.calculateOrderCost.calculate({
      tenantId: cmd.tenantId,
      // TODO: `OnboardingFacadePort` не резолвит принадлежность аптеки к сети/её координаты
      // (foundIssue DTJ-228, см. `CalculateOrderCostInput` JSDoc) — оба `null` структурно, не
      // временная заглушка этой правки.
      chainId: null,
      items: buildCostInputItems(group, reservedLines, snapshots),
      pharmacyGeoPoint: null,
      deliveryGeoPoint: address.geoPoint,
    })
    // DTJ-231 (SRS-ORD-023), поправка CTO волна 6 — ПОСЛЕ расчёта актуальной суммы, ДО
    // Order.create(): ожидание резолвится ключом `group.pharmacyId` (ПО ГРУППАМ, не одно число
    // на весь запрос) и сравнивается с `cost.itemsTotalDiram` (позиции БЕЗ доставки — доставку
    // клиент на момент подтверждения не знает, см. JSDoc `DetectPriceDriftService`). Расхождение
    // откатывает ТОЛЬКО эту группу (PriceOrStockChangedError — DomainError, ловится catch-веткой
    // processGroup, см. её JSDoc), реверсируя уже выполненный reserveStock этой же группы.
    const expectedItemsTotalDiram = cmd.expectedTotalDiramByPharmacy[group.pharmacyId] ?? null
    this.detectPriceDrift.check(expectedItemsTotalDiram, cost.itemsTotalDiram)
    const commissionByMedicine = new Map(cost.items.map((line) => [line.medicineId, line.commissionBps]))
    const items = buildItemCommands({ group, snapshots, reservedLines, idGenerator: this.idGenerator, commissionByMedicine })
    const orderNumber = await this.orderNumberGenerator.generate(toDushanbeYYMMDD(now))
    const createCmd: OrderCreateCommand = buildOrderCreateCommand({
      cmd,
      group,
      address,
      items,
      cost,
      billingStrategy,
      orderNumber,
      codLimitDiram,
      idGenerator: this.idGenerator,
      now,
    })
    const orderResult = Order.create(createCmd)
    if (!orderResult.ok) {
      throw orderResult.error
    }
    assertOrderConfirmationInvariant(orderResult.value) // D-25/D-EP09-35 (DTJ-230) — программная ошибка, не доменная
    await this.orderRepository.save(orderResult.value, tx)
    // SRS-DOM-151/D-EP09-27 (решение CTO) — outbox-запись В ТОЙ ЖЕ транзакции группы, что
    // save(): OrderConfirmedEvent (D-25, cash_courier) — единственное событие, реально
    // возможное на этом шаге (остальные методы-намерения Order — не часть checkout).
    await this.ordersOutbox.appendAll(cmd.tenantId, orderResult.value.pullDomainEvents(), tx)
    return orderResult.value
  }

  /** ПОСЛЕ commit (D-EP09-17) — non-cash → `createInvoice`, ошибка/таймаут → `paymentPending: true`, заказ не трогается. */
  private async finalizeCreatedOrders(outcomes: readonly GroupOutcome[], cmd: CheckoutCommand): Promise<CheckoutOrderResultDto[]> {
    const created = outcomes.filter((o): o is Extract<GroupOutcome, { kind: 'created' }> => o.kind === 'created')
    return Promise.all(created.map((o) => this.finalizeOneOrder(o.order, cmd)))
  }

  private async finalizeOneOrder(order: Order, cmd: CheckoutCommand): Promise<CheckoutOrderResultDto> {
    const invoiceSucceeded = order.paymentMethod === 'cash_courier' ? true : await this.tryCreateInvoice(order, cmd)
    return {
      orderId: order.id,
      orderNumber: order.orderNumber.value,
      pharmacyId: order.pharmacyId,
      status: order.status,
      totalAmountDiram: Number(order.totalAmount.diram),
      paymentPending: !invoiceSucceeded,
    }
  }

  /** D-25 — вызывается ТОЛЬКО для non-cash (проверено вызывающим `finalizeOneOrder`). */
  private async tryCreateInvoice(order: Order, cmd: CheckoutCommand): Promise<boolean> {
    const idempotencyKey = `${cmd.checkoutAttemptId}:${order.pharmacyId}`
    try {
      const result = await withTimeout(
        this.paymentInvoice.createInvoice({
          orderId: order.id,
          amountDiram: order.totalAmount.diram,
          currency: 'TJS',
          idempotencyKey,
          description: `DoruTJ order ${order.orderNumber.value}`,
          customerPhone: cmd.customerPhone,
        }),
        this.config.paymentProviderTimeoutMs,
      )
      return result.ok
    } catch {
      return false
    }
  }
}
