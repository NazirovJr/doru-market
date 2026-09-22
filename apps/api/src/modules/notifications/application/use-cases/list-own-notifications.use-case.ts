/**
 * `ListOwnNotificationsUseCase` (DTJ-372) — `GET /api/v1/notifications`.
 *
 * Аутентифицированный пользователь любой роли получает свои уведомления через курсорную пагинацию,
 * сортировку от новых к старым, фильтр по статусу. Чужие уведомления недостижимы: `userId` берётся
 * из JWT, в query такого параметра нет вообще.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  NOTIFICATIONS_REPOSITORY_PORT,
  type ListNotificationsCursor,
  type ListNotificationsInput,
  type NotificationRecord,
  type NotificationStatus,
  type NotificationsRepositoryPort,
} from '../ports/notifications-repository.port.js'

export interface ListOwnNotificationsCommand {
  readonly actor: {
    readonly userId: string
    readonly tenantId: string | null
  }
  readonly statuses?: readonly NotificationStatus[] | undefined
  readonly limit: number
  readonly cursor: ListNotificationsCursor | null
}

export interface ListOwnNotificationsResult {
  readonly items: readonly NotificationRecord[]
  readonly nextCursor: ListNotificationsCursor | null
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
      statuses: command.statuses,
      order: 'createdAt:desc',
      limit: command.limit,
      cursor: command.cursor,
    }
    const page = await this.repository.list(listInput)

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }
  }
}
