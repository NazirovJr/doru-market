/**
 * `NotificationsRepository` (DTJ-370) — реальная Drizzle-реализация `NotificationsRepositoryPort`
 * поверх `notifications` (`db/schema/notifications.ts`, миграция `0050_notifications.sql`),
 * связывается в `notifications.module.ts` ВМЕСТО `UnimplementedNotificationsRepositoryAdapter`
 * (DTJ-368/369 заглушка, удалена этим тикетом — C8, не оставлять мёртвый код после замены).
 *
 * `create()` — идемпотентность (SRS-ADM-057): `sourceEventId` задан → `INSERT ... ON CONFLICT
 * (user_id, channel, source_event_id) DO NOTHING RETURNING`, при пустом `RETURNING` — `SELECT`
 * существующей строки (тот же паттерн «insert or return existing», что
 * `MockBankProvider.insertOrReuseOperation`, `payments`). `sourceEventId` не задан — обычный
 * `INSERT` без `ON CONFLICT` (constraint не срабатывает на NULL, Postgres считает NULL
 * различными значениями в UNIQUE).
 *
 * `list()` — keyset-пагинация, тот же приём, что `DrizzleSupportTicketsRepository.list` (DTJ-282):
 * `LIMIT input.limit + 1` даёт `hasMore` без второй `COUNT`-круговой поездки, курсор —
 * `(created_at, id)` по убыванию.
 */
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

    // Конфликт (SRS-ADM-057) — та же (userId, channel, sourceEventId) уже обработана ранее
    // (at-least-once доставка outbox) — возвращаем СУЩЕСТВУЮЩУЮ строку, не создаём вторую.
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
    // `notifications.user_id` — nullable по спеке (`docs/spec/11-database-schema.md` §44), но
    // порт (`CreateNotificationInput.userId`) — обязателен: этот модуль ВСЕГДА пишет с userId,
    // фолбэк ниже — оборонительный (см. `cursorCreatedAt` в `drizzle-support-tickets.repository.ts`).
    userId: row.userId ?? '',
    tenantId: row.tenantId,
    // ENUM Postgres `notification_channel` шире `NotificationChannel` (несёт легаси `'email'`, см.
    // JSDoc `notify-provider.port.ts` §«Реестр каналов разошёлся») — этот модуль сам никогда не
    // пишет `'email'`, cast permissive (тот же приём, что `payout-schedule.repository.ts`).
    channel: row.channel as NotificationRecord['channel'],
    status: row.status,
    payload: row.payload as Record<string, unknown>,
    eventType: row.eventType ?? undefined,
    sourceEventId: row.sourceEventId ?? undefined,
    sentAt: row.sentAt,
    failedReason: row.failedReason,
    createdAt: row.createdAt,
  }
}
