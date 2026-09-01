/**
 * Ядро джобы `license-expiry-check` (DTJ-073): сканирует активные аптеки
 * через `PharmacyLicenseScannerPort` (реализация в `apps/api`, инжектируется
 * через HTTP или shared-пакет — TODO(EP-01/EP-03 wiring)), идемпотентно
 * публикует уведомления за 30/14/3 дня, и вызывает `SuspendPharmacyUseCase`
 * для истёкших лицензий.
 *
 * `SuspendPharmacyUseCase` инжектируется через DI — временная заглушка.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { LICENSE_EXPIRY_BATCH_LIMIT } from './license-expiry-check.constants.js'

export interface PharmacyLicenseRow {
  readonly id: string
  readonly licenseExpiryDate: Date | null
}

export const PHARMACY_LICENSE_SCANNER = Symbol.for('@dorutj/worker/pharmacy-license-scanner')
export interface PharmacyLicenseScannerPort {
  scanActive(limit: number): Promise<readonly PharmacyLicenseRow[]>
}

export const SUSPEND_PHARMACY_USE_CASE = Symbol.for('@dorutj/onboarding/suspend-pharmacy-use-case')
export interface SuspendPharmacyPort {
  execute(input: { pharmacyId: string; actorId: string; reason: 'license_expired' }): Promise<{ id: string }>
}

export const LICENSE_NOTICE_LOG = Symbol.for('@dorutj/worker/license-notice-log')
export interface LicenseNoticeLogPort {
  /** Insert+ignore срабатывает на UNIQUE(pharmacy_id, days_remaining, notified_on) — возвращает true если вставлено. */
  tryRecord(pharmacyId: string, daysRemaining: number, notifiedOn: Date): Promise<boolean>
}

@Injectable()
export class LicenseExpiryCheckProcessor {
  private readonly logger = new Logger(LicenseExpiryCheckProcessor.name)

  constructor(
    @Inject(PHARMACY_LICENSE_SCANNER) private readonly scanner: PharmacyLicenseScannerPort,
    @Inject(SUSPEND_PHARMACY_USE_CASE) private readonly suspendPharmacy: SuspendPharmacyPort,
    @Inject(LICENSE_NOTICE_LOG) private readonly noticeLog: LicenseNoticeLogPort,
  ) {}

  /** Один тик: число аптек, для которых выполнено авто-приостановление. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const rows = await this.scanner.scanActive(LICENSE_EXPIRY_BATCH_LIMIT)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const settled = await Promise.allSettled(
      rows.map((row) => this.processOne(row, now, todayStart)),
    )
    const errors = settled.flatMap((result, idx) => {
      if (result.status === 'rejected') {
        const id = rows[idx]?.id ?? '?'
        return [`${id}: ${String(result.reason)}`]
      }
      return []
    })
    const suspendedCount = settled.reduce<number>((acc, r) => {
      if (r.status === 'fulfilled' && r.value === 'suspended') {
        return acc + 1
      }
      return acc
    }, 0)
    if (errors.length > 0) {
      this.logger.error(`license-expiry-check: ${String(errors.length)} ошибок — ${errors.join('; ')}`)
    }
    return suspendedCount
  }

  private async processOne(
    row: PharmacyLicenseRow,
    now: Date,
    todayStart: Date,
  ): Promise<'skipped' | 'suspended' | 'noticed'> {
    const daysRemaining = computeDaysRemaining(row.licenseExpiryDate, now)
    if (daysRemaining === null) {
      return 'skipped'
    }
    if (daysRemaining <= 0) {
      await this.suspendPharmacy.execute({
        pharmacyId: row.id,
        actorId: SYSTEM_ACTOR_USER_ID,
        reason: 'license_expired',
      })
      return 'suspended'
    }
    if (NOTICE_THRESHOLDS.has(daysRemaining)) {
      await this.noticeLog.tryRecord(row.id, daysRemaining, todayStart)
      return 'noticed'
    }
    return 'skipped'
  }
}

const THIRTY_DAYS = 30
const FOURTEEN_DAYS = 14
const THREE_DAYS = 3
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

const NOTICE_THRESHOLDS = new Set([THIRTY_DAYS, FOURTEEN_DAYS, THREE_DAYS])
/** Служебный пользователь для автоматических действий (DTJ-073). */
export const SYSTEM_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'

function computeDaysRemaining(expiry: Date | null, now: Date): number | null {
  if (expiry === null) {
    return null
  }
  return Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY)
}
