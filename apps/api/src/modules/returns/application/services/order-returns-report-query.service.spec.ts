import { describe, expect, it, vi } from 'vitest'
import type { OrderReturn } from '../ports/returns-repository.port.js'
import type { ReturnsRepositoryPort, FindIncomingScope, FindIncomingResult } from '../ports/returns-repository.port.js'
import { OrderReturnsReportQueryService } from './order-returns-report-query.service.js'

function fakeReturn(id: string, requestedAt: Date): OrderReturn {
  return { id, requestedAt } as unknown as OrderReturn
}

interface FakeRepository extends ReturnsRepositoryPort {
  readonly lastScope: { current: FindIncomingScope | null }
}

function makeRepository(result: FindIncomingResult): FakeRepository {
  const lastScope: { current: FindIncomingScope | null } = { current: null }
  return {
    findById: vi.fn(),
    findActiveByOrderId: vi.fn(),
    save: vi.fn(),
    findIncoming: vi.fn((scope: FindIncomingScope) => {
      lastScope.current = scope
      return Promise.resolve(result)
    }),
    lastScope,
  }
}

describe('OrderReturnsReportQueryService.listIncoming (DTJ-433)', () => {
  it('pharmacist — скоуп сужен до pharmacyId, chainId не передаётся', async () => {
    const repository = makeRepository({ items: [], hasMore: false })
    const service = new OrderReturnsReportQueryService(repository)

    await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'pharmacist', pharmacyId: 'ph-1', chainId: 'chain-1' },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 20,
    })

    expect(repository.lastScope.current).toMatchObject({ pharmacyId: 'ph-1', chainId: null })
  })

  it('pharmacy_admin с сетью — скоуп по chainId, pharmacyId не сужает', async () => {
    const repository = makeRepository({ items: [], hasMore: false })
    const service = new OrderReturnsReportQueryService(repository)

    await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'pharmacy_admin', pharmacyId: 'ph-1', chainId: 'chain-1' },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 20,
    })

    expect(repository.lastScope.current).toMatchObject({ pharmacyId: null, chainId: 'chain-1' })
  })

  it('pharmacy_admin без сети — падает на свою аптеку (та же логика, что inventory-sync-report-query)', async () => {
    const repository = makeRepository({ items: [], hasMore: false })
    const service = new OrderReturnsReportQueryService(repository)

    await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'pharmacy_admin', pharmacyId: 'ph-1', chainId: null },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 20,
    })

    expect(repository.lastScope.current).toMatchObject({ pharmacyId: 'ph-1', chainId: null })
  })

  it('super_admin — без сужения (pharmacyId и chainId оба null, скоуп только по tenantId в репозитории)', async () => {
    const repository = makeRepository({ items: [], hasMore: false })
    const service = new OrderReturnsReportQueryService(repository)

    await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'super_admin', pharmacyId: null, chainId: null },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 20,
    })

    expect(repository.lastScope.current).toMatchObject({ pharmacyId: null, chainId: null })
  })

  it('hasMore=true — nextCursor построен из requestedAt/id последнего элемента страницы', async () => {
    const items = [fakeReturn('a', new Date('2026-01-01T00:00:00.000Z')), fakeReturn('b', new Date('2026-01-02T00:00:00.000Z'))]
    const repository = makeRepository({ items, hasMore: true })
    const service = new OrderReturnsReportQueryService(repository)

    const result = await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'super_admin', pharmacyId: null, chainId: null },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 2,
    })

    expect(result.nextCursor).toEqual({ v: '2026-01-02T00:00:00.000Z', id: 'b' })
  })

  it('hasMore=false — nextCursor null', async () => {
    const repository = makeRepository({ items: [], hasMore: false })
    const service = new OrderReturnsReportQueryService(repository)

    const result = await service.listIncoming({
      tenantId: 't1',
      actor: { role: 'super_admin', pharmacyId: null, chainId: null },
      statuses: ['return_in_transit'],
      cursor: null,
      limit: 20,
    })

    expect(result.nextCursor).toBeNull()
  })
})
