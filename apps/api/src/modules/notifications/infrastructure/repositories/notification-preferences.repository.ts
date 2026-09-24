/** Drizzle-реализация `NotificationPreferencesRepositoryPort`. `upsert()` — insert-or-update по составному PK. */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { notificationPreferences, type NotificationPreferenceRow } from '@/db/schema/notification-preferences.js'
import type { NotificationChannel } from '@/modules/notifications/application/ports/notify-provider.port.js'
import type { NotificationPreferencesRepositoryPort } from '@/modules/notifications/application/ports/notification-preferences-repository.port.js'
import { NotificationPreference } from '@/modules/notifications/domain/notification-preference.entity.js'

@Injectable()
export class NotificationPreferencesRepository implements NotificationPreferencesRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findByUserCategoryChannel(userId: string, category: string, channel: NotificationChannel): Promise<NotificationPreference | null> {
    const [row] = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.category, category),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async listByUser(userId: string): Promise<readonly NotificationPreference[]> {
    const rows = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))
    return rows.map(toDomain)
  }

  public async upsert(preference: NotificationPreference): Promise<NotificationPreference> {
    const values = {
      userId: preference.userId,
      category: preference.category,
      channel: preference.channel,
      isEnabled: preference.isEnabled,
      quietHoursStart: preference.quietHoursStart,
      quietHoursEnd: preference.quietHoursEnd,
      updatedAt: preference.updatedAt,
    }
    const [row] = await this.db
      .insert(notificationPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.category, notificationPreferences.channel],
        set: {
          isEnabled: values.isEnabled,
          quietHoursStart: values.quietHoursStart,
          quietHoursEnd: values.quietHoursEnd,
          updatedAt: values.updatedAt,
        },
      })
      .returning()
    if (row === undefined) {
      throw new Error('NotificationPreferencesRepository.upsert(): INSERT ... ON CONFLICT без RETURNING строки — не должно случиться.')
    }
    return toDomain(row)
  }
}

function toDomain(row: NotificationPreferenceRow): NotificationPreference {
  return NotificationPreference.restore({
    userId: row.userId,
    category: row.category,
    channel: row.channel as NotificationChannel, // enum БД шире NotificationChannel (легаси 'email')
    isEnabled: row.isEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    updatedAt: row.updatedAt,
  })
}
