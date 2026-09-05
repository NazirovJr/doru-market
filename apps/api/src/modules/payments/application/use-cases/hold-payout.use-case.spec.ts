/**
 * Unit-тесты `HoldPayoutUseCase` (EP-10, DTJ-249) — репозиторий замокан, три исхода тест-плана
 * тикета: `pending→disputed`, `due→disputed`, `paid` без изменений.
 */
import { describe, expect, it, vi } from 'vitest'
import type { PayoutScheduleRepository } from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { HoldPayoutUseCase, type HoldPayoutCommand } from './hold-payout.use-case.js'

function baseCommand(overrides: Partial<HoldPayoutCommand> = {}): HoldPayoutCommand {
  return { tenantId: 'tenant-1', orderId: 'order-1', disputeId: 'dispute-1', ...overrides }
}

function buildHarness(held: boolean) {
  const holdIfPending = vi.fn<PayoutScheduleRepository['holdIfPending']>().mockResolvedValue({ held })
  const repo = { reverseIfExists: vi.fn(), insertPending: vi.fn(), holdIfPending } as unknown as PayoutScheduleRepository
  const useCase = new HoldPayoutUseCase(repo)
  return { useCase, holdIfPending }
}

describe('HoldPayoutUseCase (DTJ-249)', () => {
  it('AC2: payout_schedule.status=\'pending\' — репозиторий держит (held=true) → alreadyPaid=false', async () => {
    const h = buildHarness(true)

    const result = await h.useCase.execute(baseCommand())

    expect(h.holdIfPending).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', orderId: 'order-1', disputeId: 'dispute-1' })
    expect(result).toEqual({ alreadyPaid: false })
  })

  it('AC2: payout_schedule.status=\'due\' — та же ветка held=true → alreadyPaid=false (репозиторий сам решает pending/due)', async () => {
    const h = buildHarness(true)

    const result = await h.useCase.execute(baseCommand({ orderId: 'order-due' }))

    expect(h.holdIfPending).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', orderId: 'order-due', disputeId: 'dispute-1' })
    expect(result).toEqual({ alreadyPaid: false })
  })

  it('AC3: payout_schedule.status=\'paid\' (пост-payout) — репозиторий возвращает held=false → { alreadyPaid: true }, без ошибки', async () => {
    const h = buildHarness(false)

    const result = await h.useCase.execute(baseCommand())

    expect(result).toEqual({ alreadyPaid: true })
    expect(h.holdIfPending).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', orderId: 'order-1', disputeId: 'dispute-1' })
  })
})
