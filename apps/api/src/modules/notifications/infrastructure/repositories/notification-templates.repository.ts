/** SELECT по UNIQUE(event_type, channel, locale) — не более одной строки. */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { notificationTemplates, type NotificationTemplateRow } from '@/db/schema/notification-templates.js'
import {
  NotificationTemplate,
  type NotificationTemplateChannel,
  type NotificationTemplateLocale,
  type NotificationTemplateVariablesSchema,
} from '@/modules/notifications/domain/notification-template.entity.js'
import type { NotificationTemplatesRepositoryPort } from '@/modules/notifications/application/ports/notification-templates-repository.port.js'

@Injectable()
export class NotificationTemplatesRepository implements NotificationTemplatesRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findByEventChannelLocale(
    eventType: string,
    channel: NotificationTemplateChannel,
    locale: NotificationTemplateLocale,
  ): Promise<NotificationTemplate | null> {
    const [row] = await this.db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.eventType, eventType),
          eq(notificationTemplates.channel, channel),
          eq(notificationTemplates.locale, locale),
        ),
      )
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }
}

function toDomain(row: NotificationTemplateRow): NotificationTemplate {
  return NotificationTemplate.restore({
    id: row.id,
    eventType: row.eventType,
    channel: row.channel,
    locale: row.locale as NotificationTemplateLocale,
    subject: row.subject,
    body: row.body,
    variablesSchema: row.variablesSchema as NotificationTemplateVariablesSchema,
    updatedAt: row.updatedAt,
  })
}
