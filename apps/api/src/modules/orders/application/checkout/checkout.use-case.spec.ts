/**
 * `CheckoutUseCase` (EP-09, DTJ-227) — unit-набор поверх моков ВСЕХ портов (SplitCartByPharmacyUseCase
 * — реальный инстанс, чистая функция без I/O). Покрывает 5 критериев приёмки тикета буквально
 * + явный тест D-25 (наличный заказ ни разу не вызывает `PaymentInvoicePort.createInvoice`).
 *
 * `OrdersUnitOfWorkPort`/`IdempotencyAttemptAdapter` — in-memory фикстуры ЭТОГО файла (не
 * переиспользуют auth-паттерн напрямую, порты модуль-локальны, см. JSDoc портов) — реальная
 * атомарность транзакции (SRS-ORD-019, «провал одной группы не откатывает другую») —
 * интеграционный тест на живом Postgres, вне периметра unit-набора (см. тест-план тикета).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@dorutj/domain-kernel'
import {
  CodForbiddenForRxError,
  CodLimitExceededError,
  ErrorCode,
  ForbiddenError,
  InvalidCoordinatesError,
  NoOrderableItemsError,
  type OrderPaymentMethod,
} from '@dorutj/contracts'
import type { AppConfigService } from '@/config/app-config.service.js'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { SplitCartByPharmacyUseCase } from '@/modules/orders/application/cart/split-cart-by-pharmacy.use-case.js'
import type { CartItemRecord } from '@/modules/orders/application/cart/ports/cart.repository.port.js'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { FakeCatalogFacadePort } from '@/modules/orders/testing/fixtures/fake-catalog-facade-port.fixture.js'
import type { OnboardingFacadePort } from '@/modules/orders/application/ports/onboarding-facade.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { PaymentInvoicePort } from '@/modules/orders/application/ports/payment-invoice.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'
import type { UserAddressFacadePort } from '@/modules/orders/application/ports/user-address-facade.port.js'
import type { PrescriptionsFacadePort } from '@/modules/orders/application/ports/prescriptions-facade.port.js'
import type { OrderNumberGeneratorPort } from '@/shared-kernel/application/ports/order-number-generator.port.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { IdempotencyAttemptAdapter } from '@/modules/orders/application/ports/idempotency-attempt.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { IdempotencyKeyConflictError } from '@/common/idempotency/idempotency-keys.repository.js'
import { CalculateOrderCostService } from './calculate-order-cost.service.js'
import { ResolveBillingStrategyService } from './resolve-billing-strategy.service.js'
import { ResolveDeliveryAddressService } from './resolve-delivery-address.service.js'
import { ExcludeUnverifiedRxItemsService } from './exclude-unverified-rx-items.service.js'
import { CodPolicyService } from '@/modules/orders/application/policies/cod-policy.service.js'
import { PaymentMethodEnabledPolicyService } from '@/modules/orders/application/policies/payment-method-enabled-policy.service.js'
import { PaymentMethodNotEnabledError } from './errors/payment-method-not-enabled.error.js'
import { PRESCRIPTION_NOT_VERIFIED_REASON } from './exclude-unverified-rx-items.service.js'
import { DetectPriceDriftService } from './detect-price-drift.service.js'
import type { CheckoutResultDto } from './dto/checkout-result.dto.js'
import type { CheckoutCommand } from './dto/checkout-command.dto.js'
import { CheckoutUseCase } from './checkout.use-case.js'

const DEFAULT_COD_LIMIT_DIRAM = 1_000_000n
const DEFAULT_COMMISSION_BPS = 500
const DEFAULT_ENABLED_PAYMENT_METHODS: readonly OrderPaymentMethod[] = ['cash_courier', 'alif_mobi', 'dc_next']

const NOW = new Date('2026-09-02T12:00:00.000Z')
const TENANT_ID = 'tenant-1'
const CUSTOMER_ID = 'customer-1'
const CART_ID = 'cart-1'
const PHARMACY_A = 'pharmacy-a'
const PHARMACY_B = 'pharmacy-b'
const DEFAULT_UNIT_PRICE_DIRAM = 5_000n

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0
  next(): string {
    this.counter += 1
    return `id-${String(this.counter)}`
  }
}

class FakeOrderNumberGenerator implements OrderNumberGeneratorPort {
  private counter = 0
  async generate(dateYYMMDD: string): Promise<OrderNumber> {
    this.counter += 1
    return Promise.resolve(OrderNumber.fromParts(dateYYMMDD, this.counter))
  }
}

/** In-memory UoW — не проверяет реальную атомарность (интеграционный тест, вне unit-набора). */
class PassthroughUnitOfWork implements OrdersUnitOfWorkPort {
  async run<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(undefined)
  }
}

class InMemoryIdempotencyAttemptAdapter implements IdempotencyAttemptAdapter {
  private readonly records = new Map<string, { status: 'processing' | 'completed'; result: CheckoutResultDto | null }>()

  findCompleted(userId: string, checkoutAttemptId: string): Promise<CheckoutResultDto | null> {
    const record = this.records.get(this.key(userId, checkoutAttemptId))
    if (record === undefined) return Promise.resolve(null)
    if (record.status === 'processing') {
      throw new IdempotencyKeyConflictError({ reason: 'still_processing' })
    }
    return Promise.resolve(record.result)
  }

  begin(userId: string, checkoutAttemptId: string): Promise<string> {
    const id = this.key(userId, checkoutAttemptId)
    if (this.records.has(id)) {
      throw new IdempotencyKeyConflictError({ reason: 'triple already exists' })
    }
    this.records.set(id, { status: 'processing', result: null })
    return Promise.resolve(id)
  }

  complete(id: string, result: CheckoutResultDto): Promise<void> {
    this.records.set(id, { status: 'completed', result })
    return Promise.resolve()
  }

  release(id: string): Promise<void> {
    this.records.delete(id)
    return Promise.resolve()
  }

  private key(userId: string, checkoutAttemptId: string): string {
    return `${userId}:${checkoutAttemptId}`
  }
}

function geoPointOrThrow(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw new Error('fixture: invalid GeoPoint')
  return result.value
}

function cartItem(overrides: Partial<CartItemRecord> = {}): CartItemRecord {
  return {
    id: randomUUID(),
    cartId: CART_ID,
    medicineId: randomUUID(),
    pharmacyId: PHARMACY_A,
    quantity: 2,
    addedAt: NOW,
    ...overrides,
  }
}

function buildCommand(overrides: Partial<CheckoutCommand> = {}): CheckoutCommand {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    customerPhone: '+992900000000',
    cartItemIds: [],
    deliveryAddressId: null,
    inlineAddress: { addressText: 'Dushanbe, Rudaki 1', landmarkText: null, latitude: 38.5598, longitude: 68.787 },
    deliveryLandmark: null,
    paymentMethod: 'cash_courier',
    prescriptionIds: [],
    expectedTotalDiramByPharmacy: {},
    checkoutAttemptId: randomUUID(),
    ...overrides,
  }
}

interface Harness {
  readonly useCase: CheckoutUseCase
  readonly cartRepo: InMemoryCartRepository
  readonly orderRepo: InMemoryOrderRepository
  readonly catalog: FakeCatalogFacadePort
  readonly onboarding: OnboardingFacadePort
  readonly inventory: InventoryFacadePort
  readonly payment: PaymentInvoicePort
  readonly isPharmacyActive: ReturnType<typeof vi.fn<OnboardingFacadePort['isPharmacyActive']>>
  readonly reserveStock: ReturnType<typeof vi.fn<InventoryFacadePort['reserveStock']>>
  readonly createInvoice: ReturnType<typeof vi.fn<PaymentInvoicePort['createInvoice']>>
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly getCodLimitDiram: ReturnType<typeof vi.fn<TenancyFacadePort['getCodLimitDiram']>>
  readonly getEnabledPaymentMethods: ReturnType<typeof vi.fn<TenancyFacadePort['getEnabledPaymentMethods']>>
  readonly resolveCommissionRate: ReturnType<typeof vi.fn<TenancyFacadePort['resolveCommissionRate']>>
  readonly getUserAddressById: ReturnType<typeof vi.fn<UserAddressFacadePort['getById']>>
  readonly isVerifiedFor: ReturnType<typeof vi.fn<PrescriptionsFacadePort['isVerifiedFor']>>
}

interface HarnessOverrides {
  readonly config: Partial<{ paymentProviderTimeoutMs: number }>
  readonly codLimitDiram: bigint
  readonly enabledPaymentMethods: readonly OrderPaymentMethod[]
}

function makeHarness(overrides: Partial<HarnessOverrides> = {}): Harness {
  const cartRepo = new InMemoryCartRepository()
  const orderRepo = new InMemoryOrderRepository()
  const catalog = new FakeCatalogFacadePort()

  const isPharmacyActive = vi.fn<OnboardingFacadePort['isPharmacyActive']>().mockResolvedValue(true)
  const onboarding: OnboardingFacadePort = {
    isPharmacyActive,
    getPharmacyNames: vi.fn().mockResolvedValue(new Map()),
  }

  const reserveStock = vi.fn<InventoryFacadePort['reserveStock']>().mockImplementation((pharmacyId, items) =>
    Promise.resolve(
      ok(
        items.map((item, index) => ({
          medicineId: item.medicineId,
          inventoryBatchId: `batch-${pharmacyId}-${String(index)}`,
          quantity: item.quantity,
          unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM,
        })),
      ),
    ),
  )
  const inventory: InventoryFacadePort = {
    reserveStock,
    releaseStock: vi.fn<InventoryFacadePort['releaseStock']>().mockResolvedValue(undefined),
    hasExpiredReservedBatch: vi.fn<InventoryFacadePort['hasExpiredReservedBatch']>().mockResolvedValue(false),
    getStockQuantity: vi.fn<InventoryFacadePort['getStockQuantity']>().mockResolvedValue(100),
    reserveForOrder: vi.fn<InventoryFacadePort['reserveForOrder']>(),
    reconcileZeroStock: vi.fn<InventoryFacadePort['reconcileZeroStock']>(),
  }

  const createInvoice = vi.fn<PaymentInvoicePort['createInvoice']>()
  const payment: PaymentInvoicePort = { createInvoice }

  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }

  const config = { paymentProviderTimeoutMs: 50, ...overrides.config } as unknown as AppConfigService

  // DTJ-228/229/230 — реальные application-сервисы поверх моков портов (не моки самих
  // сервисов): unit-набор проверяет РЕАЛЬНУЮ оркестрацию `CheckoutUseCase`, не подменяет её.
  const getCodLimitDiram = vi.fn<TenancyFacadePort['getCodLimitDiram']>().mockResolvedValue(overrides.codLimitDiram ?? DEFAULT_COD_LIMIT_DIRAM)
  const getEnabledPaymentMethods = vi
    .fn<TenancyFacadePort['getEnabledPaymentMethods']>()
    .mockResolvedValue(overrides.enabledPaymentMethods ?? DEFAULT_ENABLED_PAYMENT_METHODS)
  const resolveCommissionRate = vi.fn<TenancyFacadePort['resolveCommissionRate']>().mockResolvedValue(DEFAULT_COMMISSION_BPS)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate,
    getCodLimitDiram,
    getEnabledPaymentMethods,
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
  }

  const deliveryFacade: DeliveryFacadePort = { calculateFee: vi.fn<DeliveryFacadePort['calculateFee']>().mockResolvedValue(0n) }

  const getUserAddressById = vi.fn<UserAddressFacadePort['getById']>().mockResolvedValue(null)
  const userAddressFacade: UserAddressFacadePort = { getById: getUserAddressById }

  const isVerifiedFor = vi.fn<PrescriptionsFacadePort['isVerifiedFor']>().mockResolvedValue(true)
  const prescriptionsFacade: PrescriptionsFacadePort = { isVerifiedFor }

  const useCase = new CheckoutUseCase(
    cartRepo,
    onboarding,
    catalog,
    inventory,
    payment,
    tenancyFacade,
    orderRepo,
    new PassthroughUnitOfWork(),
    ordersOutbox,
    new FakeOrderNumberGenerator(),
    new SplitCartByPharmacyUseCase(),
    new InMemoryIdempotencyAttemptAdapter(),
    new FixedClock(),
    new SequentialIdGenerator(),
    config,
    new CalculateOrderCostService(tenancyFacade, deliveryFacade),
    new ResolveBillingStrategyService(),
    new ResolveDeliveryAddressService(userAddressFacade),
    new ExcludeUnverifiedRxItemsService(prescriptionsFacade),
    new CodPolicyService(tenancyFacade),
    new PaymentMethodEnabledPolicyService(tenancyFacade),
    new DetectPriceDriftService(),
  )

  return {
    useCase,
    cartRepo,
    orderRepo,
    catalog,
    onboarding,
    inventory,
    payment,
    isPharmacyActive,
    reserveStock,
    createInvoice,
    appendAll,
    getCodLimitDiram,
    getEnabledPaymentMethods,
    resolveCommissionRate,
    getUserAddressById,
    isVerifiedFor,
  }
}

function seedCart(h: Harness, items: readonly CartItemRecord[]): void {
  h.cartRepo.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, sessionToken: null })
  for (const item of items) {
    h.cartRepo.seedItem(item)
    h.catalog.setSnapshot({
      medicineId: item.medicineId,
      unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM,
      isPrescriptionRequired: false,
      controlCategory: 'none',
    })
  }
}

describe('CheckoutUseCase', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('AC1 — 2 аптеки, обе активны → orders.length === 2, свой pharmacyId/orderNumber на каждую', async () => {
    const h = makeHarness()
    const itemA = cartItem({ pharmacyId: PHARMACY_A })
    const itemB = cartItem({ pharmacyId: PHARMACY_B })
    seedCart(h, [itemA, itemB])

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [itemA.id, itemB.id] }))

    expect(result.orders).toHaveLength(2)
    const pharmacyIds = result.orders.map((o) => o.pharmacyId).sort()
    expect(pharmacyIds).toEqual([PHARMACY_A, PHARMACY_B].sort())
    expect(new Set(result.orders.map((o) => o.orderNumber)).size).toBe(2)
    expect(result.failedGroups).toEqual([])
  })

  it('AC2 — аптека Б INSUFFICIENT_STOCK, аптека А в наличии → orders содержит А, failedGroups содержит Б, А не откатывается', async () => {
    const h = makeHarness()
    const itemA = cartItem({ pharmacyId: PHARMACY_A })
    const itemB = cartItem({ pharmacyId: PHARMACY_B })
    seedCart(h, [itemA, itemB])
    h.reserveStock.mockImplementation((pharmacyId, items) => {
      if (pharmacyId === PHARMACY_B) {
        return Promise.resolve(err({ code: ErrorCode.INSUFFICIENT_STOCK, medicineId: items[0]?.medicineId ?? '' }))
      }
      return Promise.resolve(
        ok(
          items.map((item, index) => ({
            medicineId: item.medicineId,
            inventoryBatchId: `batch-${String(index)}`,
            quantity: item.quantity,
            unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM,
          })),
        ),
      )
    })

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [itemA.id, itemB.id] }))

    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]?.pharmacyId).toBe(PHARMACY_A)
    expect(result.failedGroups).toHaveLength(1)
    expect(result.failedGroups[0]).toMatchObject({ pharmacyId: PHARMACY_B, reason: ErrorCode.INSUFFICIENT_STOCK })
    // Заказ А реально сохранён — не только в ответе, но и в репозитории (без отката).
    const savedA = await h.orderRepo.findById(TENANT_ID, result.orders[0]?.orderId ?? '')
    expect(savedA).not.toBeNull()
    expect(savedA?.pharmacyId).toBe(PHARMACY_A)
  })

  it('AC3 — корзина только из товаров неактивной аптеки → 422 NO_ORDERABLE_ITEMS, ни один заказ не создан', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])
    h.isPharmacyActive.mockResolvedValue(false)

    await expect(h.useCase.execute(buildCommand({ cartItemIds: [item.id] }))).rejects.toBeInstanceOf(NoOrderableItemsError)
  })

  it('AC4 — non-cash, ЕДИНСТВЕННАЯ группа, createInvoice таймаутит → заказ создан pending_payment, paymentPending: true, без paymentTransactionId', async () => {
    const h = makeHarness({ config: { paymentProviderTimeoutMs: 20 } })
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])
    // Никогда не резолвится — симулирует зависший вызов провайдера, `withTimeout` обязан прервать по таймауту.
    h.createInvoice.mockImplementation(() => new Promise(() => { void 0 }))

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi' }))

    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]?.paymentPending).toBe(true)
    expect(result.orders[0]?.status).toBe('pending_payment')
    const saved = await h.orderRepo.findById(TENANT_ID, result.orders[0]?.orderId ?? '')
    expect(saved).not.toBeNull()
    expect(saved?.toSnapshot().paymentTransactionId).toBeNull()
    expect(saved?.status).toBe('pending_payment')
  })

  it('AC5 — повторный execute() с тем же checkoutAttemptId после завершения первого → возвращён сохранённый результат, reserveStock не вызван повторно', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])
    const cmd = buildCommand({ cartItemIds: [item.id] })

    const first = await h.useCase.execute(cmd)
    const callsAfterFirst = h.reserveStock.mock.calls.length
    const second = await h.useCase.execute(cmd)

    expect(second).toEqual(first)
    expect(h.reserveStock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('D-25 — наличный заказ НИКОГДА не вызывает PaymentInvoicePort.createInvoice (ноль вызовов)', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'cash_courier' }))

    expect(result.orders[0]?.status).toBe('confirmed')
    expect(result.orders[0]?.paymentPending).toBe(false)
    expect(h.createInvoice).not.toHaveBeenCalled()
  })

  it('SRS-DOM-151 — OrdersOutboxPort.appendAll вызван В ТОЙ ЖЕ группе с OrderConfirmedEvent для cash_courier', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'cash_courier' }))

    expect(h.appendAll).toHaveBeenCalledTimes(1)
    const [tenantId, events] = h.appendAll.mock.calls[0] ?? []
    expect(tenantId).toBe(TENANT_ID)
    expect(events).toEqual([{ type: 'OrderConfirmedEvent', orderId: result.orders[0]?.orderId, at: NOW }])
  })

  it('Ownership: cartItemIds чужой корзины (другой customerId) → ForbiddenError, заказ не создан', async () => {
    const h = makeHarness()
    h.cartRepo.seedCart({ id: 'cart-2', tenantId: TENANT_ID, customerId: 'other-customer', sessionToken: null })
    const item = cartItem({ cartId: 'cart-2', pharmacyId: PHARMACY_A })
    h.cartRepo.seedItem(item)
    h.catalog.setSnapshot({ medicineId: item.medicineId, unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM, isPrescriptionRequired: false, controlCategory: 'none' })

    await expect(h.useCase.execute(buildCommand({ cartItemIds: [item.id] }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('DTJ-228 — commissionBps резолвится через TenancyFacadePort и персистируется НЕНУЛЕВЫМ, billingStrategy=single_invoice', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi' }))

    expect(h.resolveCommissionRate).toHaveBeenCalledWith(TENANT_ID, null, 'otc')
    const saved = await h.orderRepo.findById(TENANT_ID, result.orders[0]?.orderId ?? '')
    const snapshot = saved?.toSnapshot()
    expect(snapshot?.items[0]?.commissionBps).toBe(DEFAULT_COMMISSION_BPS)
    expect(snapshot?.items[0]?.platformFeeDiram).toBeGreaterThan(0n)
    expect(snapshot?.billingStrategy).toBe('single_invoice')
  })

  it('DTJ-228 AC4 — totalAmountDiram считается сервером из актуального снэпшота, у CheckoutCommand нет клиентского поля «итог заказа» для подмены', async () => {
    // Правка DTJ-231/поправка CTO волна 6: `expectedTotalDiramByPharmacy` теперь ЯВНО сверяется
    // ПО ГРУППАМ (`DetectPriceDriftService`, SRS-ORD-023) — переданное клиентом значение больше
    // НЕ «игнорируется молча», расхождение роняет ГРУППУ `409 PRICE_OR_STOCK_CHANGED` (см.
    // `describe('DTJ-231 — дрейф цены')` ниже, включая явный тест того же сценария с намеренно
    // неверным ожиданием). Этот тест сохраняет исходное намерение DTJ-228 (сервер не доверяет
    // клиентской сумме, SRS-DOM-003) БЕЗ ожидания вовсе (пустая карта) — в `CheckoutCommand` нет
    // ДРУГОГО поля, которым клиент мог бы продиктовать `total_amount`, поэтому пересчитанное
    // значение остаётся серверным по построению.
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A }) // DEFAULT_UNIT_PRICE_DIRAM=5000 × qty=2 = 10000
    seedCart(h, [item])

    const result = await h.useCase.execute(
      buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi', expectedTotalDiramByPharmacy: {} }),
    )

    expect(result.orders[0]?.totalAmountDiram).toBe(10_000)
  })

  it('DTJ-229 AC1 — Rx-позиция + cash_courier → CodForbiddenForRxError, ни один заказ не создан', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    h.cartRepo.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, sessionToken: null })
    h.cartRepo.seedItem(item)
    h.catalog.setSnapshot({ medicineId: item.medicineId, unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM, isPrescriptionRequired: true, controlCategory: 'none' })
    h.isVerifiedFor.mockResolvedValue(true) // верифицирован — COD запрещён для Rx НЕЗАВИСИМО от верификации (SRS-DOM-156)

    await expect(
      h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'cash_courier' })),
    ).rejects.toBeInstanceOf(CodForbiddenForRxError)
    expect(h.reserveStock).not.toHaveBeenCalled() // РАННЯЯ проверка — до транзакции группы
  })

  it('DTJ-229 AC2 — total_amount_diram=60000 (>50000 лимит тенанта), non-Rx + cash_courier → CodLimitExceededError', async () => {
    const h = makeHarness({ codLimitDiram: 50_000n })
    const item = cartItem({ pharmacyId: PHARMACY_A, quantity: 6 })
    h.cartRepo.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, sessionToken: null })
    h.cartRepo.seedItem(item)
    h.catalog.setSnapshot({ medicineId: item.medicineId, unitPriceDiram: 10_000n, isPrescriptionRequired: false, controlCategory: 'none' })

    await expect(
      h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'cash_courier' })),
    ).rejects.toBeInstanceOf(CodLimitExceededError)
  })

  it('DTJ-229 AC3 — способ оплаты не в enabledPaymentMethods тенанта → PaymentMethodNotEnabledError', async () => {
    const h = makeHarness({ enabledPaymentMethods: ['cash_courier'] })
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    await expect(
      h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi' })),
    ).rejects.toBeInstanceOf(PaymentMethodNotEnabledError)
    expect(h.reserveStock).not.toHaveBeenCalled()
  })

  it('DTJ-229 AC4 — инлайн-адрес с latitude=95 (вне диапазона) → InvalidCoordinatesError', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    await expect(
      h.useCase.execute(
        buildCommand({
          cartItemIds: [item.id],
          inlineAddress: { addressText: 'x', landmarkText: null, latitude: 95, longitude: 68.787 },
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidCoordinatesError)
  })

  it('DTJ-229 AC5 — deliveryLandmark передан отдельно от сохранённого адреса → заказ содержит переданный ориентир, сохранённый адрес не мутирован', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])
    h.getUserAddressById.mockResolvedValue({
      id: 'addr-1',
      addressText: 'Dushanbe, Rudaki 5',
      landmarkText: 'старый ориентир',
      geoPoint: geoPointOrThrow(38.56, 68.78),
    })

    const result = await h.useCase.execute(
      buildCommand({
        cartItemIds: [item.id],
        deliveryAddressId: 'addr-1',
        inlineAddress: null,
        deliveryLandmark: 'новый ориентир',
        paymentMethod: 'alif_mobi',
      }),
    )

    expect(h.getUserAddressById).toHaveBeenCalledWith('addr-1', CUSTOMER_ID)
    const saved = await h.orderRepo.findById(TENANT_ID, result.orders[0]?.orderId ?? '')
    expect(saved?.toSnapshot().deliveryLandmark).toBe('новый ориентир')
    expect(saved?.toSnapshot().deliveryAddress).toBe('Dushanbe, Rudaki 5')
    // `UserAddressFacadePort` — read-only контракт (единственный метод `getById`), мутация сохранённого адреса физически невозможна отсюда.
  })

  it('DTJ-230 AC1 — Rx-товар без верификации + обычный товар той же аптеки → заказ ТОЛЬКО с обычным товаром, excludedItems содержит PRESCRIPTION_NOT_VERIFIED', async () => {
    const h = makeHarness()
    const rxItem = cartItem({ pharmacyId: PHARMACY_A })
    const plainItem = cartItem({ pharmacyId: PHARMACY_A })
    h.cartRepo.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, sessionToken: null })
    h.cartRepo.seedItem(rxItem)
    h.cartRepo.seedItem(plainItem)
    h.catalog.setSnapshot({ medicineId: rxItem.medicineId, unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM, isPrescriptionRequired: true, controlCategory: 'none' })
    h.catalog.setSnapshot({ medicineId: plainItem.medicineId, unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM, isPrescriptionRequired: false, controlCategory: 'none' })
    h.isVerifiedFor.mockResolvedValue(false)

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [rxItem.id, plainItem.id], paymentMethod: 'alif_mobi' }))

    expect(result.orders).toHaveLength(1)
    expect(result.meta.excludedItems).toEqual([{ cartItemId: rxItem.id, reason: PRESCRIPTION_NOT_VERIFIED_REASON }])
    const saved = await h.orderRepo.findById(TENANT_ID, result.orders[0]?.orderId ?? '')
    const items = saved?.toSnapshot().items ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.medicineId).toBe(plainItem.medicineId)
    // Rx-строка НЕ удалена из корзины — checkout только читает cart_items, не мутирует их.
    const cartItemsLeft = await h.cartRepo.findItemsByCartId(TENANT_ID, CART_ID)
    expect(cartItemsLeft.some((i) => i.id === rxItem.id)).toBe(true)
  })

  it('DTJ-230 AC2 — корзина ТОЛЬКО из Rx-товаров без верификации → 422 NO_ORDERABLE_ITEMS, ни один заказ не создан', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    h.cartRepo.seedCart({ id: CART_ID, tenantId: TENANT_ID, customerId: CUSTOMER_ID, sessionToken: null })
    h.cartRepo.seedItem(item)
    h.catalog.setSnapshot({ medicineId: item.medicineId, unitPriceDiram: DEFAULT_UNIT_PRICE_DIRAM, isPrescriptionRequired: true, controlCategory: 'none' })
    h.isVerifiedFor.mockResolvedValue(false)

    await expect(
      h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi' })),
    ).rejects.toBeInstanceOf(NoOrderableItemsError)
  })

  it('DTJ-230 D-25 — non-cash заказ никогда не наблюдается в confirmed (assertOrderConfirmationInvariant пройден молча)', async () => {
    const h = makeHarness()
    const item = cartItem({ pharmacyId: PHARMACY_A })
    seedCart(h, [item])

    const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], paymentMethod: 'alif_mobi' }))

    expect(result.orders[0]?.status).toBe('pending_payment')
  })

  describe('DTJ-231 — дрейф цены (SRS-ORD-023, поправка CTO волна 6 — ожидание по группам)', () => {
    it('AC1 — ожидание группы расходится с пересчитанной суммой ПОЗИЦИЙ → failedGroups[0] содержит 409 PRICE_OR_STOCK_CHANGED с details.actualTotalDiram, заказ НЕ создан, composite-ответ 200-эквивалентный (НЕ NoOrderableItemsError)', async () => {
      const h = makeHarness()
      const item = cartItem({ pharmacyId: PHARMACY_A, quantity: 2 })
      seedCart(h, [item])
      // itemsTotal = 5_000 × 2 = 10_000 диram (100.00 TJS) — сравнение ИМЕННО с ней (не с
      // total_amount, deliveryFee сюда не подмешивается). Клиент видел 8_000 (80.00 TJS) для
      // этой аптеки — расхождение > PRICE_DRIFT_TOLERANCE_DIRAM (0).

      const cmd = buildCommand({ cartItemIds: [item.id], expectedTotalDiramByPharmacy: { [PHARMACY_A]: 8_000n } })
      const result = await h.useCase.execute(cmd)

      expect(result.orders).toEqual([])
      expect(result.failedGroups).toHaveLength(1)
      expect(result.failedGroups[0]).toMatchObject({
        pharmacyId: PHARMACY_A,
        reason: ErrorCode.PRICE_OR_STOCK_CHANGED,
        details: { actualTotalDiram: 10_000, expectedTotalDiram: 8_000 },
      })
      // Заказ по этой группе не создан — резерв остатка отменён вместе с транзакцией группы:
      // ни один заказ не сохранился под этим checkoutAttemptId (идемпотентность отдельно
      // кэширует РЕЗУЛЬТАТ '{orders: [], failedGroups: [...]}', не создаёт запись заказа).
      const saved = await h.orderRepo.findByCheckoutAttemptId(TENANT_ID, cmd.checkoutAttemptId)
      expect(saved).toBeNull()
    })

    it('ожидание группы совпадает с пересчитанной суммой позиций — заказ оформляется как обычно (нет ложных срабатываний)', async () => {
      const h = makeHarness()
      const item = cartItem({ pharmacyId: PHARMACY_A, quantity: 2 })
      seedCart(h, [item])

      const result = await h.useCase.execute(
        buildCommand({ cartItemIds: [item.id], expectedTotalDiramByPharmacy: { [PHARMACY_A]: 10_000n } }),
      )

      expect(result.orders).toHaveLength(1)
      expect(result.failedGroups).toEqual([])
    })

    it('ключ группы отсутствует в expectedTotalDiramByPharmacy — проверка дрейфа для этой группы пропускается (поле опционально И целиком, И по группе, SRS-ORD-023)', async () => {
      const h = makeHarness()
      const item = cartItem({ pharmacyId: PHARMACY_A, quantity: 2 })
      seedCart(h, [item])

      const result = await h.useCase.execute(buildCommand({ cartItemIds: [item.id], expectedTotalDiramByPharmacy: {} }))

      expect(result.orders).toHaveLength(1)
      expect(result.failedGroups).toEqual([])
    })

    it('ДОКАЗАТЕЛЬСТВО (поправка CTO волна 6) — мультиаптечный checkout, ОБЕИМ группам передана ВЕРНАЯ ожидаемая сумма → ОБА заказа оформлены, ни одного ложного PRICE_OR_STOCK_CHANGED', async () => {
      const h = makeHarness()
      const itemA = cartItem({ pharmacyId: PHARMACY_A, quantity: 2 }) // 5_000 × 2 = 10_000
      const itemB = cartItem({ pharmacyId: PHARMACY_B, quantity: 1 }) // 5_000 × 1 = 5_000
      seedCart(h, [itemA, itemB])

      const result = await h.useCase.execute(
        buildCommand({
          cartItemIds: [itemA.id, itemB.id],
          expectedTotalDiramByPharmacy: { [PHARMACY_A]: 10_000n, [PHARMACY_B]: 5_000n },
        }),
      )

      expect(result.orders).toHaveLength(2)
      const pharmacyIds = result.orders.map((o) => o.pharmacyId).sort()
      expect(pharmacyIds).toEqual([PHARMACY_A, PHARMACY_B].sort())
      expect(result.failedGroups).toEqual([])
    })

    it('мультиаптечный checkout — у ОДНОЙ группы (Б) ожидание расходится с фактом → Б в failedGroups с PRICE_OR_STOCK_CHANGED и details.actualTotalDiram, А (ожидание верно) оформлена (частичный успех сохранён)', async () => {
      const h = makeHarness()
      const itemA = cartItem({ pharmacyId: PHARMACY_A, quantity: 2 }) // 10_000, ожидание верно
      const itemB = cartItem({ pharmacyId: PHARMACY_B, quantity: 1 }) // факт 5_000, клиент ждёт 4_000
      seedCart(h, [itemA, itemB])

      const result = await h.useCase.execute(
        buildCommand({
          cartItemIds: [itemA.id, itemB.id],
          expectedTotalDiramByPharmacy: { [PHARMACY_A]: 10_000n, [PHARMACY_B]: 4_000n },
        }),
      )

      expect(result.orders).toHaveLength(1)
      expect(result.orders[0]?.pharmacyId).toBe(PHARMACY_A)
      expect(result.failedGroups).toHaveLength(1)
      expect(result.failedGroups[0]).toMatchObject({
        pharmacyId: PHARMACY_B,
        reason: ErrorCode.PRICE_OR_STOCK_CHANGED,
        details: { actualTotalDiram: 5_000, expectedTotalDiram: 4_000 },
      })
    })
  })

  describe('DTJ-231 — foundIssue: NoOrderableItemsError не обязан прятать failedGroups непустых групп', () => {
    it('ВСЕ группы существовали (groups.length > 0), но КАЖДАЯ провалилась доменной ошибкой (не дрейф) → composite-ответ с пустым orders и непустым failedGroups, НЕ 422 NO_ORDERABLE_ITEMS', async () => {
      const h = makeHarness()
      const itemA = cartItem({ pharmacyId: PHARMACY_A })
      const itemB = cartItem({ pharmacyId: PHARMACY_B })
      seedCart(h, [itemA, itemB])
      h.reserveStock.mockResolvedValue(err({ code: ErrorCode.INSUFFICIENT_STOCK, medicineId: itemA.medicineId }))

      const result = await h.useCase.execute(buildCommand({ cartItemIds: [itemA.id, itemB.id] }))

      expect(result.orders).toEqual([])
      expect(result.failedGroups).toHaveLength(2)
      expect(result.failedGroups.map((g) => g.reason)).toEqual([ErrorCode.INSUFFICIENT_STOCK, ErrorCode.INSUFFICIENT_STOCK])
    })

    it('ничего не исключалось до сплита ПОТОМУ ЧТО корзина пуста после Rx/pharmacy-suspended исключений (groups.length === 0) — по-прежнему 422 NO_ORDERABLE_ITEMS (регресс существующего AC3/DTJ-230 AC2 не сломан)', async () => {
      const h = makeHarness()
      const item = cartItem({ pharmacyId: PHARMACY_A })
      seedCart(h, [item])
      h.isPharmacyActive.mockResolvedValue(false)

      await expect(h.useCase.execute(buildCommand({ cartItemIds: [item.id] }))).rejects.toBeInstanceOf(
        NoOrderableItemsError,
      )
    })
  })
})
