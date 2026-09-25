/** Тонкий passthrough к `NotificationsRepositoryPort` — тот же приём, что `ListAuditLogUseCase`. */
import { Inject, Injectable } from '@nestjs/common'
import {
  NOTIFICATIONS_REPOSITORY_PORT,
  type FindUndeliveredPage,
  type ListNotificationsCursor,
  type NotificationsRepositoryPort,
} from '../ports/notifications-repository.port.js'

export interface ListUndeliveredNotificationsCommand {
  readonly limit: number
  readonly cursor?: ListNotificationsCursor | null
}

@Injectable()
export class ListUndeliveredNotificationsUseCase {
  public constructor(
    @Inject(NOTIFICATIONS_REPOSITORY_PORT) private readonly notificationsRepository: NotificationsRepositoryPort,
  ) {}

  public async execute(command: ListUndeliveredNotificationsCommand): Promise<FindUndeliveredPage> {
    return this.notificationsRepository.findUndeliveredAcrossAllChannels({
      limit: command.limit,
      cursor: command.cursor ?? null,
    })
  }
}
