/** Drizzle-реализация `NotificationsRepositoryPort`. `create()` идемпотентен по (user_id, channel, source_event_id) — insert-or-return-existing. `list()` — keyset-пагинация. */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { notifications, type NotificationRow } from '@/db/schema/notifications.js'
import {
  type CreateNotificationInput,
  type ListNotificationsInput,
  type ListNotificationsPage,
  type NotificationRecord,
  type NotificationsRepositoryPort,
} from '@/modules/notifications/application/ports/notifications-repository.port.js'

@Injectable()
export class NotificationsRepository implements NotificationsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const values = {
      userId: input.userId,
      tenantId: input.tenantId,
      channel: input.channel,
      status: input.status,
      payload: input.payload,
      eventType: input.eventType ?? null,
      sourceEventId: input.sourceEventId ?? null,
    }

    if (input.sourceEventId === undefined) {
      const [row] = await this.db.insert(notifications).values(values).returning()
      if (row === undefined) {
        throw new Error('NotificationsRepository.create(): INSERT без RETURNING строки — не должно случиться.')
      }
      return toDomain(row)
    }

    const inserted = await this.db
      .insert(notifications)
      .values(values)
      .onConflictDoNothing({ target: [notifications.userId, notifications.channel, notifications.sourceEventId] })
      .returning()
    if (inserted[0] !== undefined) {
      return toDomain(inserted[0])
    }

    const [existing] = await this.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.userId, input.userId), eq(notifications.channel, input.channel), eq(notifications.sourceEventId, input.sourceEventId)),
      )
      .limit(1)
    if (existing === undefined) {
      throw new Error(
        `NotificationsRepository.create(): UNIQUE-конфликт (userId=${input.userId}, channel=${input.channel}, ` +
          `sourceEventId=${input.sourceEventId}), но строка не найдена — конкурентное удаление?`,
      )
    }
    return toDomain(existing)
  }

  public async list(input: ListNotificationsInput): Promise<ListNotificationsPage> {
    const conditions = [eq(notifications.userId, input.userId)]
    if (input.tenantId !== null) {
      conditions.push(eq(notifications.tenantId, input.tenantId))
    }
    if (input.statuses !== undefined && input.statuses.length > 0) {
      conditions.push(inArray(notifications.status, input.statuses))
    }
    if (input.cursor !== null) {
      const cursorCreatedAt = new Date(input.cursor.v)
      const keysetCondition = or(
        lt(notifications.createdAt, cursorCreatedAt),
        and(eq(notifications.createdAt, cursorCreatedAt), lt(notifications.id, input.cursor.id)),
      )
      if (keysetCondition !== undefined) {
        conditions.push(keysetCondition)
      }
    }

    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(input.limit + 1)

    const hasMore = rows.length > input.limit
    const page = hasMore ? rows.slice(0, input.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last !== undefined ? { v: last.createdAt.toISOString(), id: last.id } : null,
      hasMore,
    }
  }
}

function toDomain(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.userId ?? '', // user_id nullable по спеке, порт требует string — оборонительный фолбэк
    tenantId: row.tenantId,
    channel: row.channel as NotificationRecord['channel'], // enum БД шире NotificationChannel (легаси 'email')
    status: row.status,
    payload: row.payload as Record<string, unknown>,
    eventType: row.eventType ?? undefined,
    sourceEventId: row.sourceEventId ?? undefined,
    sentAt: row.sentAt,
    failedReason: row.failedReason,
    createdAt: row.createdAt,
  }
}
