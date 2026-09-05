import { describe, expect, it, vi } from 'vitest'
import type { FastifyReply } from 'fastify'
import { encodeCursor } from '@dorutj/contracts'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { ExportPayoutsCsvQuery } from '@/modules/payments/application/queries/export-payouts-csv.query.js'
import type { GetPharmacyPayoutsQuery } from '@/modules/payments/application/queries/get-pharmacy-payouts.query.js'
import { GetPayoutsController } from './get-payouts.controller.js'
import type { PharmacyReportRequestParams } from './pharmacy-report-request.decorator.js'

const CLAIMS: JwtClaims = { sub: 'user-1', role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null, sessionId: 'session-1' }

function requestParams(overrides: Partial<PharmacyReportRequestParams> = {}): PharmacyReportRequestParams {
  return { pharmacyId: 'pharmacy-1', limitRaw: undefined, cursorRaw: undefined, statusFilterRaw: undefined, ...overrides }
}

/** Отдельные переменные (не `x.execute`/`x.header`/`x.send`) — @typescript-eslint/unbound-method. */
function fakeGetPayouts(): { query: GetPharmacyPayoutsQuery; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: { v: '2026-09-04T00:00:00.000Z', id: 'payout-1' }, hasMore: true })
  return { query: { execute } as unknown as GetPharmacyPayoutsQuery, execute }
}

function fakeExportCsv(): { query: ExportPayoutsCsvQuery; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue('orderId,orderNumber\r\n')
  return { query: { execute } as unknown as ExportPayoutsCsvQuery, execute }
}

function fakeReply(): { reply: FastifyReply; header: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const header = vi.fn().mockReturnThis()
  const send = vi.fn().mockReturnThis()
  return { reply: { header, send } as unknown as FastifyReply, header, send }
}

describe('GetPayoutsController (DTJ-252)', () => {
  it('list: парсит limit/cursor/filter, вызывает GetPharmacyPayoutsQuery, кодирует meta.pagination.nextCursor', async () => {
    const { query, execute } = fakeGetPayouts()
    const controller = new GetPayoutsController(query, fakeExportCsv().query)

    const response = await controller.list(requestParams({ limitRaw: '10', statusFilterRaw: 'due,paid' }), CLAIMS)

    expect(execute).toHaveBeenCalledWith({
      pharmacyId: 'pharmacy-1',
      actor: { role: 'super_admin', chainId: null, pharmacyId: null },
      statuses: ['due', 'paid'],
      limit: 10,
      cursor: null,
    })
    expect(response.data).toEqual([])
    expect(response.meta?.pagination).toMatchObject({ hasMore: true, limit: 10 })
    expect(typeof (response.meta as { pagination: { nextCursor: string } }).pagination.nextCursor).toBe('string')
  })

  it('list: nextCursor=null → meta.pagination.nextCursor=null (не закодированная пустая строка)', async () => {
    const execute = vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
    const getPayouts = { execute } as unknown as GetPharmacyPayoutsQuery
    const controller = new GetPayoutsController(getPayouts, fakeExportCsv().query)

    const response = await controller.list(requestParams(), CLAIMS)

    expect(response.meta?.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 20 })
  })

  it('list: декодирует cursor query-параметр перед передачей в query-класс', async () => {
    const { query, execute } = fakeGetPayouts()
    const controller = new GetPayoutsController(query, fakeExportCsv().query)
    const cursorRaw = encodeCursor({ v: '2026-09-01T00:00:00.000Z', id: 'payout-0' })

    await controller.list(requestParams({ cursorRaw }), CLAIMS)

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cursor: { v: '2026-09-01T00:00:00.000Z', id: 'payout-0' } }))
  })

  it('export: устанавливает Content-Type: text/csv и отправляет сырое тело (АС4)', async () => {
    const { query: exportCsv, execute } = fakeExportCsv()
    const controller = new GetPayoutsController(fakeGetPayouts().query, exportCsv)
    const { reply, header, send } = fakeReply()

    await controller.export(requestParams(), CLAIMS, reply)

    expect(execute).toHaveBeenCalledWith({
      pharmacyId: 'pharmacy-1',
      actor: { role: 'super_admin', chainId: null, pharmacyId: null },
      statuses: undefined,
    })
    expect(header).toHaveBeenCalledWith('content-type', 'text/csv; charset=utf-8')
    expect(send).toHaveBeenCalledWith('orderId,orderNumber\r\n')
  })
})
