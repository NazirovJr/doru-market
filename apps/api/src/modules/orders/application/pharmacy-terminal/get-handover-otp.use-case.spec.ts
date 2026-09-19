/**
 * `GetHandoverOtpUseCase` (DTJ-306, EP-12 §A.5, SRS-PHT-028, TC-PHT-017/018) — просмотр
 * действующего кода вручения, RBAC (pharmacist/pharmacy_admin своей аптеки), аудит на успешный
 * просмотр. Порты замоканы/фейкнуты — реальный Postgres вне периметра этого набора.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { ForbiddenError, HandoverOtpNotFoundError, NotFoundError } from '@dorutj/contracts'
import type { OtpCodeRecord, OtpCodesRepository } from '@/modules/auth/index.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { GetHandoverOtpUseCase, type GetHandoverOtpActor, type GetHandoverOtpCommand } from './get-handover-otp.use-case.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const OTP_ID = 'otp-id-1'

const PHARMACIST_OWN: GetHandoverOtpActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: GetHandoverOtpActor = { userId: 'pharmacist-2', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: 'pharmacy-2' }
const PHARMACY_ADMIN: GetHandoverOtpActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

/** Заказ `picked_up` с действующим `handoverOtpId` — 1:1 приём `CompletePickingUseCase` спека `makeOrder`. */
function makeOrder(status: 'processing' | 'picked_up' | 'delivered', handoverOtpId: string | null = OTP_ID): Order {
  const created = Order.create(
    validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, items: [validOrderItemCommand({ pharmacyId: PHARMACY_ID })] }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, handoverOtpId })
}

function otpRecord(overrides: Partial<OtpCodeRecord> = {}): OtpCodeRecord {
  return {
    id: OTP_ID,
    tenantId: TENANT_ID,
    subjectRef: 'order-1',
    purpose: 'delivery_handover',
    codeHash: 'hash',
    plainCode: '4821',
    attempts: 0,
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 900_000),
    consumedAt: null,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: GetHandoverOtpUseCase
  readonly orderRepo: InMemoryOrderRepository
  readonly findById: ReturnType<typeof vi.fn<OtpCodesRepository['findById']>>
  readonly auditWrite: ReturnType<typeof vi.fn<AuditLogPort['write']>>
}

function makeHarness(): Harness {
  const orderRepo = new InMemoryOrderRepository()
  const findById = vi.fn<OtpCodesRepository['findById']>().mockResolvedValue(otpRecord())
  const otpCodesRepository: OtpCodesRepository = {
    create: vi.fn(),
    findById,
    findByIdForUpdate: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttempts: vi.fn(),
    findActiveBySubject: vi.fn(),
    countBySubjectAndPurpose: vi.fn(),
  }
  const auditWrite = vi.fn<AuditLogPort['write']>().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: auditWrite }
  const useCase = new GetHandoverOtpUseCase(orderRepo, otpCodesRepository, auditLog)
  return { useCase, orderRepo, findById, auditWrite }
}

function cmd(orderId: string, overrides: Partial<GetHandoverOtpCommand> = {}): GetHandoverOtpCommand {
  return { orderId, actor: PHARMACIST_OWN, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GetHandoverOtpUseCase — success (TC-PHT-017)', () => {
  it('picked_up → 200, возвращает {code, expiresAt, purpose}, пишет audit_log', async () => {
    const { useCase, orderRepo, auditWrite } = makeHarness()
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    const result = await useCase.execute(cmd(order.id))

    expect(result).toEqual({ code: '4821', expiresAt: otpRecord().expiresAt, purpose: 'delivery_handover' })
    expect(auditWrite).toHaveBeenCalledTimes(1)
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'handover_otp_viewed', entityId: order.id, actorUserId: PHARMACIST_OWN.userId }),
    )
  })
})

describe('GetHandoverOtpUseCase — status !== picked_up (TC-PHT-018)', () => {
  it('delivered → 404 HandoverOtpNotFoundError, не светит использованный код', async () => {
    const { useCase, orderRepo, findById, auditWrite } = makeHarness()
    const order = makeOrder('delivered')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
    expect(findById).not.toHaveBeenCalled()
    expect(auditWrite).not.toHaveBeenCalled()
  })

  it('processing (ещё не вручён) → 404 HandoverOtpNotFoundError', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder('processing', null)
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
  })
})

describe('GetHandoverOtpUseCase — otp_codes строка недоступна', () => {
  it('handoverOtpId указывает на несуществующую строку → 404 (не 500)', async () => {
    const { useCase, orderRepo, findById } = makeHarness()
    findById.mockResolvedValue(null)
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
  })

  it('plainCode=null (строка создана до DTJ-306) → 404, не отдаёт null как код', async () => {
    const { useCase, orderRepo, findById } = makeHarness()
    findById.mockResolvedValue(otpRecord({ plainCode: null }))
    const order = makeOrder('picked_up')
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(HandoverOtpNotFoundError)
  })
})

describe('GetHandoverOtpUseCase — RBAC/NotFound', () => {
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
