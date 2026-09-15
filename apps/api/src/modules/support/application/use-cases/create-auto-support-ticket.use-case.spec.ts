/**
 * Unit-тест `CreateAutoSupportTicketUseCase` (EP-14, DTJ-281, тест-план тикета: «те же кейсы,
 * что DTJ-279, но с фиксированным `channel='system_auto'`»). `CreateSupportTicketUseCase`
 * целиком замокан (не его порты) — эта use case ничего не знает про репозиторий/outbox/UoW
 * напрямую, только делегирует, оркестрация самого создания уже покрыта
 * `create-support-ticket.use-case.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CreateSupportTicketUseCase } from './create-support-ticket.use-case.js'
import { CreateAutoSupportTicketUseCase, type CreateAutoSupportTicketCommand } from './create-auto-support-ticket.use-case.js'

const TENANT_ID = 'tenant-1'
const TICKET_ID = 'ticket-1'
const ORDER_ID = 'order-1'

function buildHarness(): { useCase: CreateAutoSupportTicketUseCase; executeMock: ReturnType<typeof vi.fn> } {
  const executeMock = vi.fn().mockResolvedValue({ ticketId: TICKET_ID })
  const createSupportTicket = { execute: executeMock } as unknown as CreateSupportTicketUseCase
  return { useCase: new CreateAutoSupportTicketUseCase(createSupportTicket), executeMock }
}

describe('CreateAutoSupportTicketUseCase', () => {
  it('критерий приёмки 1 — делегирует CreateSupportTicketUseCase с channel=system_auto, createdBy не передан (домен подставит null)', async () => {
    const { useCase, executeMock } = buildHarness()
    const command: CreateAutoSupportTicketCommand = {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      category: 'order_not_received',
      description: 'Delivery SLA breached',
    }

    const result = await useCase.execute(command)

    expect(result).toEqual({ id: TICKET_ID, status: 'open', category: 'order_not_received' })
    expect(executeMock).toHaveBeenCalledOnce()
    const [passedCommand] = executeMock.mock.calls[0] as [Record<string, unknown>]
    expect(passedCommand).toMatchObject({
      tenantId: TENANT_ID,
      channel: 'system_auto',
      category: 'order_not_received',
      orderId: ORDER_ID,
      description: 'Delivery SLA breached',
    })
    expect(passedCommand).not.toHaveProperty('createdBy')
  })

  it('orderId/description не переданы (общий канал обращения без привязки к заказу) — не просачиваются как literal undefined', async () => {
    const { useCase, executeMock } = buildHarness()

    await useCase.execute({ tenantId: TENANT_ID, category: 'other' })

    const [passedCommand] = executeMock.mock.calls[0] as [Record<string, unknown>]
    expect(passedCommand).not.toHaveProperty('orderId')
    expect(passedCommand).not.toHaveProperty('description')
  })
})
