/**
 * `RegenerateHandoverOtpUseCase` (DTJ-306, EP-12 §A.5, SRS-PHT-029, TC-PHT-019/020) — новая
 * строка `otp_codes` (append-only), атомарное переключение `orders.handover_otp_id`, rate-limit
 * (лимит регенераций через `countBySubjectAndPurpose` + минимальный интервал, оба из
 * `tenant_settings`), аудит на успех. Порты замоканы/фейкнуты — реальный Postgres вне периметра.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { ForbiddenError, HandoverOtpNotFoundError, HandoverOtpRegenerationRateLimitedError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import type { OtpCodeRecord, OtpCodesRepository, OtpGeneratorPort } from '@/modules/auth/index.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import {
  RegenerateHandoverOtpUseCase,
  type RegenerateHandoverOtpActor,
  type RegenerateHandoverOtpCommand,
} from './regenerate-handover-otp.use-case.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const OLD_OTP_ID = 'otp-id-old'
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const DEFAULT_MAX_REGENERATIONS = 20
const DEFAULT_MIN_INTERVAL_SECONDS = 60

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0

  next(): string {
    this.counter += 1
    return `otp-id-new-${String(this.counter)}`
  }
}

const PASSTHROUGH_UOW: OrdersUnitOfWorkPort = { run: (callback) => callback(undefined) }

const PHARMACIST_OWN: RegenerateHandoverOtpActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: RegenerateHandoverOtpActor = { userId: 'pharmacist-2', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: 'pharmacy-2' }
const PHARMACY_ADMIN: RegenerateHandoverOtpActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

/** Заказ `picked_up` с действующим handover-OTP — 1:1 приём `CompletePickingUseCase` спека `makeOrder`. */
function makeOrder(status: 'processing' | 'picked_up'): Order {
  const created = Order.create(
    validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, items: [validOrderItemCommand({ pharmacyId: PHARMACY_ID })] }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, handoverOtpId: status === 'picked_up' ? OLD_OTP_ID : null })
}

function oldOtpRecord(overrides: Partial<OtpCodeRecord> = {}): OtpCodeRecord {
  return {
    id: OLD_OTP_ID,
    tenantId: TENANT_ID,
    subjectRef: 'order-1',
    purpose: 'delivery_handover',
    codeHash: 'old-hash',
    plainCode: '1111',
    attempts: 0,
    issuedAt: new Date(NOW.getTime() - 120_000), // 2 минуты назад — старше дефолтного min-interval (60с)
    expiresAt: new Date(NOW.getTime() + 780_000),
    consumedAt: null,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: RegenerateHandoverOtpUseCase
  readonly orderRepo: InMemoryOrderRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly otpGenerate: ReturnType<typeof vi.fn<OtpGeneratorPort['generate']>>
  readonly otpCodesCreate: ReturnType<typeof vi.fn<OtpCodesRepository['create']>>
  readonly findById: ReturnType<typeof vi.fn<OtpCodesRepository['findById']>>
  readonly countBySubjectAndPurpose: ReturnType<typeof vi.fn<OtpCodesRepository['countBySubjectAndPurpose']>>
  readonly getMaxRegenerations: ReturnType<typeof vi.fn<TenancyFacadePort['getHandoverOtpMaxRegenerationsPerOrder']>>
  readonly getMinInterval: ReturnType<typeof vi.fn<TenancyFacadePort['getHandoverOtpRegenerateMinIntervalSeconds']>>
  readonly auditWrite: ReturnType<typeof vi.fn<AuditLogPort['write']>>
}

function makeHarness(): Harness {
  const orderRepo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }
  const otpGenerate = vi.fn<OtpGeneratorPort['generate']>().mockReturnValue({ code: '4821', codeHash: 'unsalted-hash' })
  const otpGenerator: OtpGeneratorPort = { generate: otpGenerate }
  const otpCodesCreate = vi.fn<OtpCodesRepository['create']>().mockImplementation((input) =>
    Promise.resolve({ ...input, plainCode: input.plainCode ?? null, attempts: 0, consumedAt: null }),
  )
  const findById = vi.fn<OtpCodesRepository['findById']>().mockResolvedValue(oldOtpRecord())
  // 1 (исходная строка от CompletePickingUseCase) — по умолчанию 0 регенераций уже выполнено.
  const countBySubjectAndPurpose = vi.fn<OtpCodesRepository['countBySubjectAndPurpose']>().mockResolvedValue(1)
  const otpCodesRepository: OtpCodesRepository = {
    create: otpCodesCreate,
    findById,
    findByIdForUpdate: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttempts: vi.fn(),
    findActiveBySubject: vi.fn(),
    countBySubjectAndPurpose,
  }
  const getMaxRegenerations = vi
    .fn<TenancyFacadePort['getHandoverOtpMaxRegenerationsPerOrder']>()
    .mockResolvedValue(DEFAULT_MAX_REGENERATIONS)
  const getMinInterval = vi
    .fn<TenancyFacadePort['getHandoverOtpRegenerateMinIntervalSeconds']>()
    .mockResolvedValue(DEFAULT_MIN_INTERVAL_SECONDS)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: getMaxRegenerations,
    getHandoverOtpRegenerateMinIntervalSeconds: getMinInterval,
  }
  const auditWrite = vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: auditWrite }
  const useCase = new RegenerateHandoverOtpUseCase(
    orderRepo,
    PASSTHROUGH_UOW,
    otpGenerator,
    otpCodesRepository,
    tenancyFacade,
    new FixedClock(),
    new SequentialIdGenerator(),
    auditLog,
    ordersOutbox,
  )
  return {
    useCase,
    orderRepo,
    appendAll,
    otpGenerate,
    otpCodesCreate,
    findById,
    countBySubjectAndPurpose,
    getMaxRegenerations,
    getMinInterval,
    auditWrite,
  }
}

function cmd(orderId: string, overrides: Partial<RegenerateHandoverOtpCommand> = {}): RegenerateHandoverOtpCommand {
  return { orderId, actor: PHARMACIST_OWN, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegenerateHandoverOtpUseCase — success (TC-PHT-019)', () => {
  it('код истёк → 200, новый code, старый FK заменён, regenerationsUsed=1, audit_log записан', async () => {
    const { useCase, orderRepo, appendAll, otpGenerate, auditWrite } = makeHarness()
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    const result = await useCase.execute(cmd(order.id))

    expect(result).toEqual({
      code: '4821',
      expiresAt: new Date(NOW.getTime() + 900_000),
      purpose: 'delivery_handover',
      regenerationsUsed: 1,
    })
    expect(otpGenerate).toHaveBeenCalledTimes(1)
    expect(otpGenerate).toHaveBeenCalledWith('delivery_handover')
    const saved = await orderRepo.findById(TENANT_ID, order.id)
    const savedSnapshot = saved?.toSnapshot()
    expect(savedSnapshot?.handoverOtpId).toBe('otp-id-new-1')
    expect(savedSnapshot?.handoverOtpId).not.toBe(OLD_OTP_ID)
    expect(appendAll).toHaveBeenCalledTimes(1)
    const [, events] = appendAll.mock.calls[0] ?? []
    expect(events).toEqual([
      { type: 'HandoverOtpRegeneratedEvent', orderId: order.id, deliveryAssignmentId: null, regeneratedAt: NOW, regenerationsUsed: 1 },
    ])
    expect(auditWrite).toHaveBeenCalledTimes(1)
    expect(auditWrite).toHaveBeenCalledWith(expect.objectContaining({ action: 'handover_otp_regenerated', entityId: order.id }))
  })
})

describe('RegenerateHandoverOtpUseCase — rate-limit: лимит регенераций (TC-PHT-020)', () => {
  it('21 строка уже существует (20 регенераций выполнено) → 429 RATE_LIMITED, не создаёт новую строку', async () => {
    const { useCase, orderRepo, countBySubjectAndPurpose, otpCodesCreate } = makeHarness()
    countBySubjectAndPurpose.mockResolvedValue(DEFAULT_MAX_REGENERATIONS + 1)
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpRegenerationRateLimitedError)
    expect(otpCodesCreate).not.toHaveBeenCalled()
  })

  it('лимит меньше дефолта (per-tenant tenant_settings) — применяется значение из TenancyFacadePort', async () => {
    const { useCase, orderRepo, getMaxRegenerations, countBySubjectAndPurpose } = makeHarness()
    getMaxRegenerations.mockResolvedValue(1)
    countBySubjectAndPurpose.mockResolvedValue(2)
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpRegenerationRateLimitedError)
  })
})

describe('RegenerateHandoverOtpUseCase — rate-limit: минимальный интервал', () => {
  it('с прошлой регенерации прошло меньше min-interval → 429 RATE_LIMITED', async () => {
    const { useCase, orderRepo, findById, otpCodesCreate } = makeHarness()
    findById.mockResolvedValue(oldOtpRecord({ issuedAt: new Date(NOW.getTime() - 10_000) })) // 10с назад < 60с
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpRegenerationRateLimitedError)
    expect(otpCodesCreate).not.toHaveBeenCalled()
  })

  it('интервал выдержан (ровно на границе) → успех', async () => {
    const { useCase, orderRepo, findById } = makeHarness()
    findById.mockResolvedValue(oldOtpRecord({ issuedAt: new Date(NOW.getTime() - DEFAULT_MIN_INTERVAL_SECONDS * 1000) }))
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).resolves.toMatchObject({ code: '4821' })
  })
})

describe('RegenerateHandoverOtpUseCase — status !== picked_up', () => {
  it('processing (ещё не вручён) → 404 HandoverOtpNotFoundError', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder('processing')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
  })
})

describe('RegenerateHandoverOtpUseCase — RBAC/NotFound', () => {
  it('чужая аптека → ForbiddenError', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id, { actor: PHARMACIST_OTHER }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin своей аптеки — допущен (тикет: pharmacist/pharmacy_admin)', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id, { actor: PHARMACY_ADMIN }))).resolves.toMatchObject({ code: '4821' })
  })

  it('заказ не найден → NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(useCase.execute(cmd(randomUUID()))).rejects.toBeInstanceOf(NotFoundError)
  })
})
