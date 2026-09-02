/**
 * Тест `LicenseExpiryCheckProcessor.runOnce` (DTJ-073).
 */
import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LICENSE_EXPIRY_BATCH_LIMIT } from './license-expiry-check.constants.js'
import {
  LicenseExpiryCheckProcessor,
  SYSTEM_ACTOR_USER_ID,
  type LicenseNoticeLogPort,
  type PharmacyLicenseRow,
  type PharmacyLicenseScannerPort,
  type SuspendPharmacyPort,
} from './license-expiry-check.processor.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-02T08:00:00.000Z')
const TODAY_START = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate())

function expiryInDays(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY)
}

describe('LicenseExpiryCheckProcessor', () => {
  // Отдельные переменные для моков — иначе @typescript-eslint/unbound-method ругается на
  // ссылку на метод интерфейса без вызова (конвенция OutboxRelayProcessor.spec.ts).
  let scanActiveMock: Mock<PharmacyLicenseScannerPort['scanActive']>
  let suspendExecuteMock: Mock<SuspendPharmacyPort['execute']>
  let tryRecordMock: Mock<LicenseNoticeLogPort['tryRecord']>
  let processor: LicenseExpiryCheckProcessor

  beforeEach(() => {
    scanActiveMock = vi.fn()
    suspendExecuteMock = vi.fn().mockResolvedValue({ id: 'ignored' })
    tryRecordMock = vi.fn().mockResolvedValue(true)
    const scanner: PharmacyLicenseScannerPort = { scanActive: scanActiveMock }
    const suspendPharmacy: SuspendPharmacyPort = { execute: suspendExecuteMock }
    const noticeLog: LicenseNoticeLogPort = { tryRecord: tryRecordMock }
    processor = new LicenseExpiryCheckProcessor(scanner, suspendPharmacy, noticeLog)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function row(id: string, licenseExpiryDate: Date | null): PharmacyLicenseRow {
    return { id, licenseExpiryDate }
  }

  it('пустая выборка: не падает и не дёргает порты приостановки/уведомлений', async () => {
    scanActiveMock.mockResolvedValue([])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(0)
    expect(scanActiveMock).toHaveBeenCalledWith(LICENSE_EXPIRY_BATCH_LIMIT)
    expect(suspendExecuteMock).not.toHaveBeenCalled()
    expect(tryRecordMock).not.toHaveBeenCalled()
  })

  it('licenseExpiryDate=null — пропускается, порты не вызываются', async () => {
    scanActiveMock.mockResolvedValue([row('P-null', null)])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(0)
    expect(suspendExecuteMock).not.toHaveBeenCalled()
    expect(tryRecordMock).not.toHaveBeenCalled()
  })

  it('daysRemaining вне порогов уведомлений (например 10) — пропускается', async () => {
    scanActiveMock.mockResolvedValue([row('P-mid', expiryInDays(10))])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(0)
    expect(suspendExecuteMock).not.toHaveBeenCalled()
    expect(tryRecordMock).not.toHaveBeenCalled()
  })

  it('лицензия истекла (daysRemaining<=0) — приостанавливает аптеку с SYSTEM_ACTOR_USER_ID', async () => {
    scanActiveMock.mockResolvedValue([row('P-expired', expiryInDays(0))])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(1)
    expect(suspendExecuteMock).toHaveBeenCalledWith({
      pharmacyId: 'P-expired',
      actorId: SYSTEM_ACTOR_USER_ID,
      reason: 'license_expired',
    })
    expect(tryRecordMock).not.toHaveBeenCalled()
  })

  it('лицензия истекла ещё раньше (daysRemaining<0) — тоже приостанавливает', async () => {
    scanActiveMock.mockResolvedValue([row('P-old', expiryInDays(-5))])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(1)
    expect(suspendExecuteMock).toHaveBeenCalledTimes(1)
  })

  it.each([30, 14, 3])(
    'daysRemaining=%i — записывает уведомление через noticeLog.tryRecord, не приостанавливает',
    async (days) => {
      scanActiveMock.mockResolvedValue([row('P-notice', expiryInDays(days))])

      const suspended = await processor.runOnce(NOW)

      expect(suspended).toBe(0)
      expect(suspendExecuteMock).not.toHaveBeenCalled()
      expect(tryRecordMock).toHaveBeenCalledWith('P-notice', days, TODAY_START)
    },
  )

  it('обрабатывает несколько строк одновременно и считает только фактически приостановленные', async () => {
    scanActiveMock.mockResolvedValue([
      row('P-expired', expiryInDays(0)),
      row('P-notice-30', expiryInDays(30)),
      row('P-skip', expiryInDays(10)),
      row('P-null', null),
    ])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(1)
    expect(suspendExecuteMock).toHaveBeenCalledTimes(1)
    expect(tryRecordMock).toHaveBeenCalledTimes(1)
  })

  it('ошибка порта suspendPharmacy для одной строки не прерывает обработку остальных и логируется', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    suspendExecuteMock.mockImplementation((input) =>
      input.pharmacyId === 'P-fail'
        ? Promise.reject(new Error('suspend use-case unavailable'))
        : Promise.resolve({ id: 'ok' }),
    )
    scanActiveMock.mockResolvedValue([row('P-fail', expiryInDays(0)), row('P-ok', expiryInDays(-1))])

    const suspended = await processor.runOnce(NOW)

    expect(suspended).toBe(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message] = errorSpy.mock.calls[0] as [string]
    expect(message).toContain('1')
    expect(message).toContain('suspend use-case unavailable')
  })

  it('использует переданный `now`, а не реальное время (детерминированный тест)', async () => {
    const fixedNow = new Date('2020-01-01T00:00:00.000Z')
    scanActiveMock.mockResolvedValue([row('P-x', new Date(fixedNow.getTime() + 3 * MS_PER_DAY))])

    await processor.runOnce(fixedNow)

    expect(tryRecordMock).toHaveBeenCalledWith(
      'P-x',
      3,
      new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate()),
    )
  })
})
