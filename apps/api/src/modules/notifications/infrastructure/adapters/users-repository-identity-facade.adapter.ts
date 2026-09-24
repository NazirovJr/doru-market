/**
 * `UsersRepositoryIdentityFacadeAdapter` (DTJ-368, EP-16) — реализация `IdentityFacadePort` поверх
 * УЖЕ РЕАЛЬНОГО `UsersRepository` модуля `auth` (`USERS_REPOSITORY`, публичный экспорт
 * `modules/auth/index.ts`, EP-01) — см. JSDoc `identity-facade.port.ts` §«Отличие от текста тикета»
 * про то, почему гостевая правка `auth` не понадобилась.
 *
 * НЕ `useExisting` в `notifications.module.ts` (в отличие от 3 портов `modules/admin`, DTJ-350):
 * форма `IdentityFacadePort.getRecipientProfile` не совпадает НИ С ОДНИМ методом `UsersRepository`
 * структурно — нужен реальный класс-адаптер, не псевдоним токена.
 */
import { Inject, Injectable } from '@nestjs/common'
import { USERS_REPOSITORY, type UsersRepository } from '@/modules/auth/index.js'
import {
  type IdentityFacadePort,
  type NotificationRecipientProfile,
} from '@/modules/notifications/application/ports/identity-facade.port.js'

@Injectable()
export class UsersRepositoryIdentityFacadeAdapter implements IdentityFacadePort {
  public constructor(@Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepository) {}

  public async getRecipientProfile(userId: string): Promise<NotificationRecipientProfile | null> {
    const user = await this.usersRepository.findById(userId)
    if (user === null) {
      return null
    }
    return { tenantId: user.tenantId, telegramChatId: user.telegramChatId, preferredLocale: user.preferredLocale }
  }
}
