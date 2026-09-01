/**
 * `GetMeUseCase` (EP-01, DTJ-028 follow-up, SRS-API-025) — получение профиля
 * текущего аутентифицированного пользователя.
 *
 * Самый простой use case в модуле `auth`: по `userId` из JWT-claims
 * (AuthGuard подтверждает валидность токена ДО вызова use case'а) —
 * `users.findById(userId)`. Если пользователь удалён (`deletedAt !== null`)
 * или заблокирован (`isActive === false`) — `401 TOKEN_INVALID` через
 * `AuthGuard`-семантику: токен был выдан ВАЛИДНО, но состояние изменилось.
 *
 * Архитектурные замечания:
 *   - `tenantId`/`pharmacyId`/`chainId` в ответе берутся из БД (`User`-строка),
 *     а НЕ из JWT-claims. Причина: claims могут быть устаревшими (если
 *     `super_admin` сменил `chainId` пользователя, новые значения видны
 *     только при refresh; здесь — «свежее» состояние). DTJ-025 §«Риски».
 *   - `phoneNumber` в ответе — `string | null` (Telegram-путь без телефона,
 *     DTJ-027). Контроллер решает, как его отдавать (null vs пустая строка).
 *   - `isActive=false` обрабатывается как `TOKEN_INVALID`: нельзя отдавать
 *     профиль заблокированного пользователя. Это согласовано с
 *     `RevokeAllUseCase` (`reason='admin_disabled'`) — после revoke
 *     последующие запросы `/auth/me` → 401.
 *
 * Не выбрасывает `Error` для `findById === null` или `isActive=false` —
 * возвращает `Result.err(InvalidTokenError(...))` (новый класс), и
 * `AllExceptionsFilter` (DTJ-029) маппит на `401 TOKEN_INVALID`. Это
 * компромисс между «404 NOT_FOUND» (раскрытие факта существования
 * пользователя) и «401 TOKEN_INVALID» (сильнее — токен скомпрометирован).
 * SRS-API-067 + стандартный advice: для аутентифицированных ручек лучше
 * 401/403, чем 404, чтобы не палить структуру БД.
 */
import { Inject, Injectable } from '@nestjs/common'
import { TokenInvalidatedError } from '@dorutj/contracts'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import {
  USERS_REPOSITORY,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type User } from '@/modules/auth/domain/user.js'

export interface GetMeInput {
  /** `userId` из JWT-claims (`@CurrentUser().sub`). */
  readonly userId: string
}

export type GetMeResult = Result<User, TokenInvalidatedError>

@Injectable()
export class GetMeUseCase {
  constructor(@Inject(USERS_REPOSITORY) private readonly users: UsersRepository) {}

  async execute(input: GetMeInput): Promise<GetMeResult> {
    const user = await this.users.findById(input.userId)
    // `findById` уже фильтрует `deletedAt IS NULL`. Дополнительно проверяем
    // `isActive` (мягкая блокировка через `isActive=false`, без удаления).
    // В обоих случаях возвращаем `TOKEN_INVALID`, чтобы не палить структуру
    // БД (см. JSDoc).
    if (!user?.isActive) {
      return Promise.resolve(
        err(
          new TokenInvalidatedError(
            { userId: input.userId },
          ),
        ),
      )
    }
    return Promise.resolve(ok(user))
  }
}
