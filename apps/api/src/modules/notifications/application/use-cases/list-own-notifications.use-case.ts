/**
 * `ListOwnNotificationsUseCase` (DTJ-372) — `GET /api/v1/notifications`.
 *
 * Аутентифицированный пользователь любой роли получает свои уведомления через курсорную пагинацию,
 * сортировку от новых к старым, фильтр по статусу. Чужие уведомления недостижимы: `userId` берётся
 * из JWT, в query такого параметра нет вообще.
 */
import { Injectable, Inject } from '@nestjs/common'
import type { NotificationStatus, NotificationsRepositoryPort, ListNotificationsInput } from '../ports/notifications-repository.port.js'
import { NOTIFICATIONS_REPOSITORY_PORT } from '../ports/notifications-repository.port.js'
import { type NotificationSummary } from '@dorutj/contracts'

export interface ListOwnNotificationsCursor {
  readonly v: string
  readonly id: string
}

export interface ListOwnNotificationsCommand {
  readonly actor: {
    readonly userId: string
    readonly tenantId: string
  }
  readonly status?: NotificationStatus | undefined
  readonly limit: number
  readonly cursor?: ListOwnNotificationsCursor | null
}

export interface ListOwnNotificationsResult {
  readonly items: readonly NotificationSummary[]
  readonly nextCursor: ListOwnNotificationsCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListOwnNotificationsUseCase {
  public constructor(
    @Inject(NOTIFICATIONS_REPOSITORY_PORT)
    private readonly repository: NotificationsRepositoryPort,
  ) {}

  public async execute(command: ListOwnNotificationsCommand): Promise<ListOwnNotificationsResult> {
    const listInput: ListNotificationsInput = {
      userId: command.actor.userId,
      tenantId: command.actor.tenantId,
      status: command.status ?? undefined,
      limit: command.limit,
      cursor: command.cursor ?? null,
    }
    const page = await this.repository.list(listInput)

    const nextCursor =
      page.hasMore && page.nextCursor !== null
        ? { v: page.nextCursor.v, id: page.nextCursor.id }
        : null

    return {
      items: page.items.map((record) => ({
        id: record.id,
        userId: record.userId,
        tenantId: record.tenantId,
        channel: record.channel,
        status: record.status,
        payload: record.payload,
        sentAt: record.sentAt === null ? null : record.sentAt.toISOString(),
        failedReason: record.failedReason,
        createdAt: record.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore: page.hasMore,
    }
  }
}
