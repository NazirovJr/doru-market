/**
 * `IdentityFacadePort` (DTJ-368, EP-16) — узкий порт `notifications` над модулем идентичности
 * (Interface Segregation, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3, тот же приём, что 4 порта
 * `modules/admin` из DTJ-350).
 *
 * **Отличие от текста тикета DTJ-368** (задокументировано умышленно, не молча): тикет описывает
 * это как «`IdentityFacadePort.getTelegramChatId` — гостевая правка чужого модуля identity» и
 * сам же предупреждает в «Рисках» — «координировать с владельцем, чтобы не создать дублирующий
 * метод, если аналогичный уже существует под другим именем». Он существует: модуль называется
 * `auth` (не `identity`), и `UsersRepository.findById(userId)` (уже публичный экспорт
 * `modules/auth/index.ts`, EP-01/DTJ-022) возвращает `User.telegramChatId`/`User.tenantId`
 * напрямую (`apps/api/src/modules/auth/domain/user.ts`) — ГОСТЕВАЯ правка `auth` не понадобилась
 * вообще, порт ниже просто сужает уже существующий публичный `UsersRepository` до 2 полей,
 * реально нужных провайдерам этого модуля (адаптер — `infrastructure/adapters/
 * users-repository-identity-facade.adapter.ts`).
 *
 * Оба поля одним методом (не 2 отдельных `getTelegramChatId`/`getTenantId`) — оба провайдера,
 * которым нужен этот порт (`TelegramNotifyProvider`, `InAppNotifyProvider`), в конечном счёте
 * читают ОДНУ и ту же строку `users`; отдельные методы означали бы 2 похода к репозиторию там,
 * где достаточно одного.
 */

export interface NotificationRecipientProfile {
  readonly tenantId: string
  readonly telegramChatId: bigint | null
  /** Источник локали для выбора шаблона; сужение/дефолт — на стороне вызывающего. */
  readonly preferredLocale: string
}

export const IDENTITY_FACADE_PORT = Symbol.for('@dorutj/notifications/identity-facade-port')

export interface IdentityFacadePort {
  /** `null` — пользователь не найден (soft-deleted тоже не находится, см. `UsersRepository.findById`). */
  getRecipientProfile(userId: string): Promise<NotificationRecipientProfile | null>
}
