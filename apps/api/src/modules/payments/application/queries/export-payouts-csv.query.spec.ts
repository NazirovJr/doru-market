import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import type { PayoutReportRow, PayoutScheduleRepository } from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import type { PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { ExportPayoutsCsvQuery } from './export-payouts-csv.query.js'

const SUPER_ADMIN = { role: 'super_admin' as const, chainId: null, pharmacyId: null }
const HEADER = 'orderId,orderNumber,grossAmountDiram,commissionDiram,netAmountDiram,status,dueAt,paidAt'

function row(overrides: Partial<PayoutReportRow>): PayoutReportRow {
  return {
    orderId: 'order-1',
    orderNumber: 'DTJ-260904-00001',
    grossAmountDiram: 20_000n,
    commissionDiram: 1_600n,
    netAmountDiram: 18_400n,
    status: 'due',
    dueAt: null,
    paidAt: null,
    ...overrides,
  }
}

/** Возвращает порт И отдельную переменную `findAllByPharmacy` (не `repository.findAllByPharmacy`) — @typescript-eslint/unbound-method. */
function fakePayoutRepository(rows: readonly PayoutReportRow[]): { repository: PayoutScheduleRepository; findAllByPharmacy: ReturnType<typeof vi.fn> } {
  const findAllByPharmacy = vi.fn().mockResolvedValue(rows)
  const repository: PayoutScheduleRepository = {
    reverseIfExists: vi.fn(),
    insertPending: vi.fn(),
    holdIfPending: vi.fn(),
    findByPharmacy: vi.fn(),
    findAllByPharmacy,
  }
  return { repository, findAllByPharmacy }
}

function fakeChainLookup(chainId: string | null = null): PharmacyChainLookupPort {
  return { findChainId: vi.fn().mockResolvedValue(chainId) }
}

describe('ExportPayoutsCsvQuery (DTJ-252, АС4)', () => {
  it('заголовок + одна строка, числа/даты без кавычек, findAllByPharmacy (не курсорный)', async () => {
    const { repository, findAllByPharmacy } = fakePayoutRepository([row({ dueAt: new Date('2026-09-05T00:00:00.000Z'), paidAt: null })])
    const query = new ExportPayoutsCsvQuery(repository, fakeChainLookup())

    const csv = await query.execute({ pharmacyId: 'pharmacy-1', actor: SUPER_ADMIN })

    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines[1]).toBe('order-1,DTJ-260904-00001,20000,1600,18400,due,2026-09-05T00:00:00.000Z,')
    expect(lines[lines.length - 1]).toBe('') // завершающий CRLF
    expect(findAllByPharmacy).toHaveBeenCalledWith('pharmacy-1', undefined)
  })

  it('пустой набор строк — только заголовок', async () => {
    const { repository } = fakePayoutRepository([])
    const query = new ExportPayoutsCsvQuery(repository, fakeChainLookup())

    const csv = await query.execute({ pharmacyId: 'pharmacy-1', actor: SUPER_ADMIN })

    expect(csv).toBe(`${HEADER}\r\n`)
  })

  it('RFC4180: поле с запятой квотируется', async () => {
    const { repository } = fakePayoutRepository([row({ orderNumber: 'DTJ-A,B' })])
    const csv = await new ExportPayoutsCsvQuery(repository, fakeChainLookup()).execute({ pharmacyId: 'p1', actor: SUPER_ADMIN })
    expect(csv).toContain('"DTJ-A,B"')
  })

  it('RFC4180: внутренние кавычки экранируются удвоением', async () => {
    const { repository } = fakePayoutRepository([row({ orderNumber: 'DTJ-"X"' })])
    const csv = await new ExportPayoutsCsvQuery(repository, fakeChainLookup()).execute({ pharmacyId: 'p1', actor: SUPER_ADMIN })
    expect(csv).toContain('"DTJ-""X"""')
  })

  it('CSV/formula injection: поле, начинающееся с "=", получает защитный ведущий апостроф', async () => {
    const { repository } = fakePayoutRepository([row({ orderNumber: '=cmd|/c calc' })])
    const csv = await new ExportPayoutsCsvQuery(repository, fakeChainLookup()).execute({ pharmacyId: 'p1', actor: SUPER_ADMIN })
    const dataLine = csv.split('\r\n')[1] ?? ''
    expect(dataLine.split(',')[1]).toBe("'=cmd|/c calc")
  })

  it.each(['=', '+', '-', '@'])('CSV/formula injection: триггер-символ "%s" нейтрализован на status', async (trigger) => {
    const { repository } = fakePayoutRepository([row({ status: `${trigger}SUM(A1:A9)` })])
    const csv = await new ExportPayoutsCsvQuery(repository, fakeChainLookup()).execute({ pharmacyId: 'p1', actor: SUPER_ADMIN })
    const dataLine = csv.split('\r\n')[1] ?? ''
    expect(dataLine).toContain(`'${trigger}SUM(A1:A9)`)
  })

  it('pharmacy_admin чужой сети — 403, репозиторий НЕ читается', async () => {
    const { repository, findAllByPharmacy } = fakePayoutRepository([])
    const query = new ExportPayoutsCsvQuery(repository, fakeChainLookup('chain-a'))

    await expect(
      query.execute({ pharmacyId: 'pharmacy-1', actor: { role: 'pharmacy_admin', chainId: 'chain-b', pharmacyId: null } }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(findAllByPharmacy).not.toHaveBeenCalled()
  })
})
