// Zod-схема — здесь, не в @dorutj/contracts: ссылается на CRITICAL_CATEGORIES домена, а contracts не зависит от apps/api.
import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { ValidationError, NOTIFICATION_CHANNEL_VALUES } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import {
  NOTIFICATION_PREFERENCES_REPOSITORY_PORT,
  toPreferenceView,
  type NotificationPreferenceView,
  type NotificationPreferencesRepositoryPort,
} from '../ports/notification-preferences-repository.port.js'
import { isCriticalCategory, NotificationPreference } from '../../domain/notification-preference.entity.js'

const CATEGORY_MAX_LENGTH = 50
const TIME_STRING_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

const preferenceItemSchema = z.object({
  category: z.string().min(1).max(CATEGORY_MAX_LENGTH),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  isEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(TIME_STRING_PATTERN).nullable().optional(),
  quietHoursEnd: z.string().regex(TIME_STRING_PATTERN).nullable().optional(),
})

const updatePreferencesPatchSchema = z.object({
  preferences: z.array(preferenceItemSchema).min(1),
})

export type UpdatePreferenceItemInput = z.infer<typeof preferenceItemSchema>

export interface UpdateUserPreferencesCommand {
  readonly userId: string
  readonly rawPatch: unknown
}

@Injectable()
export class UpdateUserPreferencesUseCase {
  public constructor(
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY_PORT) private readonly repository: NotificationPreferencesRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: UpdateUserPreferencesCommand): Promise<readonly NotificationPreferenceView[]> {
    const patch = parsePatch(command.rawPatch)
    const now = this.clock.now()
    const preferences = await Promise.all(patch.preferences.map((item) => this.applyItem(command.userId, item, now)))
    return preferences.map(toPreferenceView)
  }

  private async applyItem(userId: string, item: UpdatePreferenceItemInput, now: Date): Promise<NotificationPreference> {
    const existing = await this.repository.findByUserCategoryChannel(userId, item.category, item.channel)
    const preference = NotificationPreference.create(
      {
        userId,
        category: item.category,
        channel: item.channel,
        isEnabled: resolveIsEnabled(item, existing),
        quietHoursStart: resolveOptionalField(item.quietHoursStart, existing?.quietHoursStart ?? null),
        quietHoursEnd: resolveOptionalField(item.quietHoursEnd, existing?.quietHoursEnd ?? null),
      },
      now,
    )
    return this.repository.upsert(preference)
  }
}

function resolveIsEnabled(item: UpdatePreferenceItemInput, existing: NotificationPreference | null): boolean {
  if (isCriticalCategory(item.category)) {
    return true
  }
  return item.isEnabled ?? existing?.isEnabled ?? true
}

/** `undefined` в патче — поле не тронуто (оставить как было); явный `null` — очистить. */
function resolveOptionalField(requested: string | null | undefined, existing: string | null): string | null {
  return requested === undefined ? existing : requested
}

function parsePatch(rawPatch: unknown): z.infer<typeof updatePreferencesPatchSchema> {
  const parsed = updatePreferencesPatchSchema.safeParse(rawPatch)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid notification preferences patch', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
