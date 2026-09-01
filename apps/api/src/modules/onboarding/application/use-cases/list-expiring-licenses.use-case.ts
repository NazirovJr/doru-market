/**
 * `ListExpiringLicensesUseCase` (DTJ-073) — список активных аптек с
 * `license_expiry_date <= today + withinDays`, отсортированный по дате
 * истечения (ближайшие сначала). Для админ-UI и `apps/admin`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'

export interface ListExpiringLicensesInput {
  readonly withinDays: number
  readonly limit?: number
  readonly offset?: number
}

export interface ListExpiringLicensesResult {
  readonly items: readonly {
    readonly id: string
    readonly licenseNumber: string
    readonly licenseExpiryDate: Date | null
    readonly daysRemaining: number | null
  }[]
  readonly total: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND

@Injectable()
export class ListExpiringLicensesUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
  ) {}

  async execute(input: ListExpiringLicensesInput, now: Date = new Date()): Promise<ListExpiringLicensesResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(input.offset ?? 0, 0)
    const threshold = new Date(now.getTime() + input.withinDays * MS_PER_DAY)
    const { items, total } = await this.pharmacyAccountRepository.listByStatus({
      status: 'active',
      licenseExpiryBefore: threshold,
      limit,
      offset,
    })
    return {
      items: items.map((it) => ({
        id: it.id,
        licenseNumber: it.licenseNumber ?? '',
        licenseExpiryDate: it.licenseExpiryDate,
        daysRemaining: computeDaysRemaining(it.licenseExpiryDate, now),
      })),
      total,
    }
  }
}

function computeDaysRemaining(expiry: Date | null, now: Date): number | null {
  if (expiry === null) {
    return null
  }
  return Math.ceil((expiry.getTime() - now.getTime()) / MS_PER_DAY)
}
