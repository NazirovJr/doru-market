// Тихие часы + переключатель категории уведомлений; таймзона Asia/Dushanbe фиксирована (единая для всех тенантов).
import { ErrorCode, ValidationError, type NotificationChannel } from '@dorutj/contracts'

export const CRITICAL_CATEGORIES = ['order_updates', 'delivery_otp'] as const
export type CriticalCategory = (typeof CRITICAL_CATEGORIES)[number]

export function isCriticalCategory(category: string): boolean {
  return (CRITICAL_CATEGORIES as readonly string[]).includes(category)
}

export class CriticalCategoryCannotBeDisabledError extends ValidationError {
  constructor(category: string) {
    super(`Critical category "${category}" cannot be disabled`, { category }, ErrorCode.CRITICAL_CATEGORY_CANNOT_BE_DISABLED)
  }
}

export interface NotificationPreferenceSnapshot {
  readonly userId: string
  readonly category: string
  readonly channel: NotificationChannel
  readonly isEnabled: boolean
  // "HH:MM:SS" (формат Postgres TIME); null — тихие часы не заданы.
  readonly quietHoursStart: string | null
  readonly quietHoursEnd: string | null
  readonly updatedAt: Date
}

export type NotificationPreferenceCreateCommand = Omit<NotificationPreferenceSnapshot, 'updatedAt'>

const DUSHANBE_TIME_ZONE = 'Asia/Dushanbe'
const TIME_STRING_PATTERN = /^(\d{2}):(\d{2})/
const MINUTES_PER_HOUR = 60

export class NotificationPreference {
  private constructor(private readonly snapshot: NotificationPreferenceSnapshot) {}

  static create(command: NotificationPreferenceCreateCommand, now: Date): NotificationPreference {
    if (!command.isEnabled && isCriticalCategory(command.category)) {
      throw new CriticalCategoryCannotBeDisabledError(command.category)
    }
    return new NotificationPreference({ ...command, updatedAt: now })
  }

  static restore(snapshot: NotificationPreferenceSnapshot): NotificationPreference {
    return new NotificationPreference(snapshot)
  }

  get userId(): string {
    return this.snapshot.userId
  }

  get category(): string {
    return this.snapshot.category
  }

  get channel(): NotificationChannel {
    return this.snapshot.channel
  }

  get isEnabled(): boolean {
    return this.snapshot.isEnabled
  }

  get quietHoursStart(): string | null {
    return this.snapshot.quietHoursStart
  }

  get quietHoursEnd(): string | null {
    return this.snapshot.quietHoursEnd
  }

  get updatedAt(): Date {
    return this.snapshot.updatedAt
  }

  // Критичная категория игнорирует тихие часы полностью (даже без quietHours* — сразу false).
  shouldSuppressNow(now: Date): boolean {
    if (isCriticalCategory(this.snapshot.category)) {
      return false
    }
    const { quietHoursStart, quietHoursEnd } = this.snapshot
    if (quietHoursStart === null || quietHoursEnd === null) {
      return false
    }
    return isWithinQuietHoursWindow(toDushanbeMinutesSinceMidnight(now), parseTimeToMinutes(quietHoursStart), parseTimeToMinutes(quietHoursEnd))
  }
}

// start включительно, end исключительно; start===end трактуется как "без тихих часов" (ASSUMPTION).
function isWithinQuietHoursWindow(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }
  if (startMinutes > endMinutes) {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes
  }
  return false
}

function parseTimeToMinutes(time: string): number {
  const match = TIME_STRING_PATTERN.exec(time)
  if (match === null) {
    throw new Error(`NotificationPreference: невалидный формат TIME "${time}", ожидался "HH:MM..."`)
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours * MINUTES_PER_HOUR + minutes
}

function toDushanbeMinutesSinceMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUSHANBE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return get('hour') * MINUTES_PER_HOUR + get('minute')
}
