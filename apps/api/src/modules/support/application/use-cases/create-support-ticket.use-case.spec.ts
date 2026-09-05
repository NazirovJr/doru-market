/**
 * Unit-тест `CreateSupportTicketUseCase` (EP-14, DTJ-279, тест-план тикета) — все порты замоканы
 * (`application` не знает о реальной инфраструктуре, `02` §3). Фокус — оркестрация: порядок
 * вызовов, границы транзакции (единый `tx`-маркер на `save`+`append`), какие ветки
 * `assertOwnershipIfCustomerOrder` реально пропускают проверку владения и какие её требуют.
 *
 * АС1 (`is_escrow_blocking=false` в БД для всех 6 категорий), АС2/АС3/АС4 против РЕАЛЬНОГО
 * Postgres — `test/integration/support/create-support-ticket.integration.spec.ts`; здесь —
 * дополняющее покрытие `application/` (порог 90%, DoD тикета), которое не требует БД и потому
 * детерминировано и быстро.
 *
 * Моки хранятся как ИМЕНОВАННЫЕ переменные (`saveMock`, `belongsToCustomerMock`, ...), не как
 * поля объекта, типизированного портом: порты объявлены через method-shorthand
 * (`save(...): Promise<void>`), и обращение к `port.method` КАК К ЗНАЧЕНИЮ (для `expect(...)`)
 * — ровно тот случай, что ловит `@typescript-eslint/unbound-method`.
 */
import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, ValidationError, type SupportTicketChannel, type UserRole } from '@dorutj/contracts'
import type { SupportTicket } from '../../domain/index.js'
import type { SupportUnitOfWorkPort, SupportUnitOfWorkTx } from '../ports/support-unit-of-work.port.js'
import { CreateSupportTicketUseCase, type CreateSupportTicketCommand } from './create-support-ticket.use-case.js'

const TX_MARKER: SupportUnitOfWorkTx = { marker: 'tx' }
const FIXED_NOW = new Date('2026-09-04T10:00:00.000Z')
const TICKET_ID = 'ticket-1'
const TENANT_ID = 'tenant-1'
const ORDER_ID = 'order-1'
const CUSTOMER_ID = 'customer-1'
const SLA_MINUTES = 60
const MS_PER_MINUTE = 60_000

/**
 * `orderId`/`createdBy`/`description` — `| undefined` явно в типе (не просто `?:`): под
 * `exactOptionalPropertyTypes` это единственный способ позволить тесту явно потребовать «поле
 * отсутствует» (`{ orderId: undefined }`), отличая это от «не упомянуто — бери дефолт» через
 * `resolveOptional` ниже. Финальный объект строится тем же приёмом conditional-spread, что сам use
 * case (см. его JSDoc) — исключает буквальный `key: undefined` в РЕЗУЛЬТИРУЮЩЕМ объекте.
 */
interface CommandOverrides {
  readonly channel?: SupportTicketChannel
  readonly category?: string
  readonly actorRole?: UserRole
  readonly orderId?: string | undefined
  readonly createdBy?: string | undefined
  readonly description?: string | undefined
}

function resolveOptional(
  overrides: CommandOverrides,
  key: 'orderId' | 'createdBy' | 'description',
  fallback: string,
): string | undefined {
  return key in overrides ? overrides[key] : fallback
}

function baseCommand(overrides: CommandOverrides = {}): CreateSupportTicketCommand {
  const orderId = resolveOptional(overrides, 'orderId', ORDER_ID)
  const createdBy = resolveOptional(overrides, 'createdBy', CUSTOMER_ID)
  const description = resolveOptional(overrides, 'description', 'test')
  return {
    tenantId: TENANT_ID,
    channel: overrides.channel ?? 'in_app',
    category: overrides.category ?? 'other',
    actorRole: overrides.actorRole ?? 'customer',
    ...(orderId !== undefined && { orderId }),
    ...(createdBy !== undefined && { createdBy }),
    ...(description !== undefined && { description }),
  }
}

/**
 * Гарантирует, что `save()`/`append()` реально вызваны на ОДНОМ И ТОМ ЖЕ `tx` (АС4, на уровне
 * оркестрации). Моки — именованные переменные, не поля порт-типизированного объекта (см. JSDoc
 * файла — `unbound-method`); порт-объекты собираются из них ниже БЕЗ явной аннотации типом порта,
 * структурная совместимость проверяется на месте вызова конструктора use case.
 */
function buildHarness() {
  const callOrder: string[] = []
  const saveMock = vi.fn((_ticket: SupportTicket, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('save')
    return Promise.resolve()
  })
  const findByIdMock = vi.fn()
  const belongsToCustomerMock = vi.fn().mockResolvedValue(true)
  const getFirstResponseSlaMinutesMock = vi.fn().mockResolvedValue(SLA_MINUTES)
  const appendMock = vi.fn((_tenantId: string, _event: unknown, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('append')
    return Promise.resolve()
  })
  const nextMock = vi.fn(() => TICKET_ID)
  const nowMock = vi.fn(() => FIXED_NOW)

  const repository = { save: saveMock, findById: findByIdMock }
  const ordersFacade = { belongsToCustomer: belongsToCustomerMock }
  const tenantSettings = { getFirstResponseSlaMinutes: getFirstResponseSlaMinutesMock }
  const outbox = { append: appendMock }
  const unitOfWork: SupportUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }
  const ids = { next: nextMock }
  const clock = { now: nowMock }

  const useCase = new CreateSupportTicketUseCase(repository, ordersFacade, tenantSettings, unitOfWork, outbox, ids, clock)
  return {
    useCase,
    saveMock,
    findByIdMock,
    belongsToCustomerMock,
    getFirstResponseSlaMinutesMock,
    appendMock,
    nextMock,
    nowMock,
    callOrder,
  }
}

function savedTicket(saveMock: ReturnType<typeof vi.fn>): SupportTicket {
  const [ticket] = saveMock.mock.calls[0] as [SupportTicket, SupportUnitOfWorkTx]
  return ticket
}

describe('CreateSupportTicketUseCase', () => {
  it('happy path — customer владеет orderId → save() и append() вызваны РОВНО один раз, В ЭТОМ порядке, на ОДНОМ tx, возвращает ticketId', async () => {
    const h = buildHarness()

    const result = await h.useCase.execute(baseCommand())

    expect(result).toEqual({ ticketId: TICKET_ID })
    expect(h.callOrder).toEqual(['save', 'append'])
    const [, saveTx] = h.saveMock.mock.calls[0] as [SupportTicket, SupportUnitOfWorkTx]
    const [, , appendTx] = h.appendMock.mock.calls[0] as [string, unknown, SupportUnitOfWorkTx]
    expect(saveTx).toBe(TX_MARKER)
    expect(appendTx).toBe(TX_MARKER)
  })

  it('AC3 — customer с ЧУЖИМ orderId (belongsToCustomer=false) → ForbiddenError, save()/append() НИКОГДА не вызваны', async () => {
    const h = buildHarness()
    h.belongsToCustomerMock.mockResolvedValue(false)

    await expect(h.useCase.execute(baseCommand())).rejects.toBeInstanceOf(ForbiddenError)

    expect(h.belongsToCustomerMock).toHaveBeenCalledWith(TENANT_ID, ORDER_ID, CUSTOMER_ID)
    expect(h.saveMock).not.toHaveBeenCalled()
    expect(h.appendMock).not.toHaveBeenCalled()
  })

  it('orderId задан, createdBy отсутствует (customer, канал не system_auto) — belongsToCustomer вызван с пустой строкой (defensive `?? \'\'`), не с undefined', async () => {
    const h = buildHarness()
    h.belongsToCustomerMock.mockResolvedValue(false)

    await expect(h.useCase.execute(baseCommand({ createdBy: undefined }))).rejects.toBeInstanceOf(ForbiddenError)

    expect(h.belongsToCustomerMock).toHaveBeenCalledWith(TENANT_ID, ORDER_ID, '')
  })

  it('orderId отсутствует → belongsToCustomer НИКОГДА не вызывается (channel=phone, без заказа)', async () => {
    const h = buildHarness()

    await h.useCase.execute(baseCommand({ orderId: undefined, channel: 'phone' }))

    expect(h.belongsToCustomerMock).not.toHaveBeenCalled()
  })

  it('channel=system_auto С orderId — belongsToCustomer НЕ вызывается, даже если actorRole=customer', async () => {
    const h = buildHarness()

    await h.useCase.execute(baseCommand({ channel: 'system_auto', createdBy: undefined }))

    expect(h.belongsToCustomerMock).not.toHaveBeenCalled()
    expect(h.saveMock).toHaveBeenCalledTimes(1)
  })

  it('actorRole=support_agent с ЧУЖИМ orderId — belongsToCustomer НЕ вызывается (проверка владения только для customer)', async () => {
    const h = buildHarness()
    h.belongsToCustomerMock.mockResolvedValue(false)

    await h.useCase.execute(baseCommand({ actorRole: 'support_agent' }))

    expect(h.belongsToCustomerMock).not.toHaveBeenCalled()
    expect(h.saveMock).toHaveBeenCalledTimes(1)
  })

  it('невалидная category → ValidationError домена (SupportTicketCategory.parse), save()/append() не вызваны', async () => {
    const h = buildHarness()

    await expect(h.useCase.execute(baseCommand({ category: 'not_a_real_category' }))).rejects.toBeInstanceOf(ValidationError)

    expect(h.saveMock).not.toHaveBeenCalled()
    expect(h.appendMock).not.toHaveBeenCalled()
  })

  it('createdBy отсутствует для НЕ-system_auto канала (без orderId — проверка владения не участвует) → ValidationError домена (SRS-ADM-074), не ForbiddenError', async () => {
    const h = buildHarness()

    await expect(
      h.useCase.execute(baseCommand({ orderId: undefined, createdBy: undefined, channel: 'phone' })),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(h.belongsToCustomerMock).not.toHaveBeenCalled()
    expect(h.saveMock).not.toHaveBeenCalled()
  })

  it('firstResponseSlaMinutes читается через TenantSettingsPort.getFirstResponseSlaMinutes(tenantId) — значение реально течёт в SupportTicket.open()', async () => {
    const CUSTOM_MINUTES = 45
    const h = buildHarness()
    h.getFirstResponseSlaMinutesMock.mockResolvedValue(CUSTOM_MINUTES)

    await h.useCase.execute(baseCommand())

    expect(h.getFirstResponseSlaMinutesMock).toHaveBeenCalledWith(TENANT_ID)
    const ticket = savedTicket(h.saveMock)
    expect(ticket.firstResponseDueAt?.getTime()).toBe(FIXED_NOW.getTime() + CUSTOM_MINUTES * MS_PER_MINUTE)
  })

  it('SupportTicketCreatedEvent — priority:0 и поля 1:1 с созданным тикетом', async () => {
    const h = buildHarness()

    await h.useCase.execute(baseCommand({ category: 'payment_issue' }))

    expect(h.appendMock).toHaveBeenCalledWith(
      TENANT_ID,
      {
        type: 'SupportTicketCreatedEvent',
        ticketId: TICKET_ID,
        tenantId: TENANT_ID,
        orderId: ORDER_ID,
        category: 'payment_issue',
        channel: 'in_app',
        priority: 0,
      },
      TX_MARKER,
    )
  })

  it('exactOptionalPropertyTypes: orderId/createdBy/description отсутствуют (system_auto) → домен получает null, не undefined-«дыры»', async () => {
    const h = buildHarness()

    await h.useCase.execute(
      baseCommand({ channel: 'system_auto', orderId: undefined, createdBy: undefined, description: undefined }),
    )

    const ticket = savedTicket(h.saveMock)
    expect(ticket.orderId).toBeNull()
    expect(ticket.createdBy).toBeNull()
    expect(ticket.description).toBeNull()
    expect(ticket.isEscrowBlocking).toBe(false)
  })
})
