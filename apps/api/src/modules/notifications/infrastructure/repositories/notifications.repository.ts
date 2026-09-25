/** Drizzle-реализация `NotificationsRepositoryPort`. `create()` идемпотентен по (user_id, channel, source_event_id) — insert-or-return-existing. `list()` — keyset-пагинация. */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull, lt, or, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { notifications, type NotificationRow } from '@/db/schema/notifications.js'
import { listEventsWithExternalFallback } from '@/modules/notifications/application/notification-event-matrix.js'
import {
  type CreateNotificationInput,
  type FindUndeliveredInput,
  type FindUndeliveredPage,
  type ListNotificationsInput,
  type ListNotificationsPage,
  type NotificationRecord,
  type NotificationsRepositoryPort,
  type UndeliveredChannelAttempt,
  type UndeliveredNotificationGroup,
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

  /** Два запроса: 1) страница «якорных» строк провалившегося последнего внешнего канала, 2) все каналы тех же групп. */
  public async findUndeliveredAcrossAllChannels(input: FindUndeliveredInput): Promise<FindUndeliveredPage> {
    const anchorMatch = buildAnchorMatch()
    if (anchorMatch === null) {
      return { items: [], nextCursor: null, hasMore: false }
    }

    const anchorRows = await this.fetchAnchorPage(anchorMatch, input)
    const hasMore = anchorRows.length > input.limit
    const page = hasMore ? anchorRows.slice(0, input.limit) : anchorRows
    if (page.length === 0) {
      return { items: [], nextCursor: null, hasMore: false }
    }

    const groupsByKey = await this.fetchGroupAttempts(page)
    const items = page.map((anchor) => toUndeliveredGroup(anchor, groupsByKey))
    const last = page[page.length - 1]
    return {
      items,
      nextCursor: hasMore && last !== undefined ? { v: last.createdAt.toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  private async fetchAnchorPage(anchorMatch: SQL, input: FindUndeliveredInput): Promise<NotificationRow[]> {
    const conditions = [eq(notifications.status, 'failed'), isNotNull(notifications.userId), isNotNull(notifications.sourceEventId), anchorMatch]
    if (input.cursor !== null) {
      const cursorCreatedAt = new Date(input.cursor.v)
      const keyset = or(lt(notifications.createdAt, cursorCreatedAt), and(eq(notifications.createdAt, cursorCreatedAt), lt(notifications.id, input.cursor.id)))
      if (keyset !== undefined) {
        conditions.push(keyset)
      }
    }
    return this.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(input.limit + 1)
  }

  /** Все строки (все каналы) групп (userId, sourceEventId) анонсированных `page` — для полной раскладки попыток. */
  private async fetchGroupAttempts(page: readonly NotificationRow[]): Promise<Map<string, NotificationRow[]>> {
    const groupConditions = page
      .filter((row): row is NotificationRow & { userId: string; sourceEventId: string } => row.userId !== null && row.sourceEventId !== null)
      .map((row) => and(eq(notifications.userId, row.userId), eq(notifications.sourceEventId, row.sourceEventId)))
    const groupMatch = or(...groupConditions)
    if (groupMatch === undefined) {
      return new Map()
    }
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(isNotNull(notifications.userId), isNotNull(notifications.sourceEventId), groupMatch))
      .orderBy(notifications.createdAt)

    const groupsByKey = new Map<string, NotificationRow[]>()
    for (const row of rows) {
      const key = groupKey(row.userId, row.sourceEventId)
      const bucket = groupsByKey.get(key)
      if (bucket === undefined) {
        groupsByKey.set(key, [row])
      } else {
        bucket.push(row)
      }
    }
    return groupsByKey
  }
}

function groupKey(userId: string | null, sourceEventId: string | null): string {
  return `${userId ?? ''}:${sourceEventId ?? ''}`
}

/** `OR` по всем (eventType, последний внешний канал) матрицы — `null`, если у НИ ОДНОГО события внешних каналов нет. */
function buildAnchorMatch(): SQL | null {
  const conditions = listEventsWithExternalFallback().map((entry) => and(eq(notifications.eventType, entry.eventType), eq(notifications.channel, entry.lastChannel)))
  return or(...conditions) ?? null
}

function toUndeliveredGroup(anchor: NotificationRow, groupsByKey: Map<string, NotificationRow[]>): UndeliveredNotificationGroup {
  const key = groupKey(anchor.userId, anchor.sourceEventId)
  const rows = groupsByKey.get(key) ?? [anchor]
  const attempts: UndeliveredChannelAttempt[] = rows.map((row) => ({
    channel: row.channel as UndeliveredChannelAttempt['channel'],
    status: row.status,
    failedReason: row.failedReason,
    attemptedAt: row.createdAt,
  }))
  return {
    userId: anchor.userId ?? '', // оборонительный фолбэк — anchor всегда имеет userId (isNotNull в WHERE)
    tenantId: anchor.tenantId,
    eventType: anchor.eventType ?? '', // оборонительный фолбэк — anchor всегда матчит конкретный eventType из матрицы
    sourceEventId: anchor.sourceEventId ?? '',
    attempts,
    lastAttemptAt: anchor.createdAt,
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
