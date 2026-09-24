/** `GetUserPreferencesUseCase` (DTJ-371) — собственные настройки уведомлений пользователя (`scope=own`). */
import { Inject, Injectable } from '@nestjs/common'
import {
  NOTIFICATION_PREFERENCES_REPOSITORY_PORT,
  toPreferenceView,
  type NotificationPreferenceView,
  type NotificationPreferencesRepositoryPort,
} from '../ports/notification-preferences-repository.port.js'

export interface GetUserPreferencesQuery {
  readonly userId: string
}

@Injectable()
export class GetUserPreferencesUseCase {
  public constructor(
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY_PORT) private readonly repository: NotificationPreferencesRepositoryPort,
  ) {}

  public async execute(query: GetUserPreferencesQuery): Promise<readonly NotificationPreferenceView[]> {
    const preferences = await this.repository.listByUser(query.userId)
    return preferences.map(toPreferenceView)
  }
}
