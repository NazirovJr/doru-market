/**
 * Порт `UsersRepository` (EP-01, DTJ-022, DTJ-024).
 *
 * Минимальный набор операций для R1:
 *   - `findByTenantAndPhone(tenantId, phoneNumber)` — для OTP verify (DTJ-024);
 *     возвращает `null`, если не найден (НЕ бросает — это «не найдено», не «ошибка»).
 *   - `findById(id)` — для guards/HTTP-контроллеров, достать `User` по `sub` из JWT.
 *   - `create(command)` — для DTJ-024 (find-or-create при первом входе).
 *   - `findOrCreateByTenantAndPhone(command)` (DTJ-024) — атомарно
 *     `findByTenantAndPhone` + `create` (если не найден). Drizzle-реализация
 *     использует `INSERT ... ON CONFLICT (tenantId, phoneNumber) WHERE
 *     deletedAt IS NULL DO NOTHING RETURNING *` + `SELECT`. InMemory —
 *     sequential find/create (гонок нет, Map синхронен).
 *   - `update(id, patch)` — для редактирования профиля (R2, здесь — заглушка).
 *
 * Soft-delete (`deletedAt IS NULL`) применяется ВСЕГДА в `findBy*` — это
 * первый и единственный репозиторий на `users`, абстракцию `soft-deletable.repository.ts`
 * не выделяем (C15, DTJ-014 §«Что сделать» п.4 — выделить при появлении ВТОРОГО потребителя).
 */
import { type UserRole } from '@dorutj/contracts'
import { type User } from '../../domain/user.js'

export const USERS_REPOSITORY = Symbol.for('@dorutj/auth/users-repository')

export interface CreateUserInput {
  readonly tenantId: string
  /**
   * [DTJ-027, SRS-API-031] NULLABLE: Telegram-путь первого входа (без
   * телефона). OTP-путь (DTJ-024) — всегда непустая строка.
   */
  readonly phoneNumber: string | null
  readonly role: UserRole
  readonly fullName: string | null
  /**
   * [DTJ-030, SRS-API-035] `pharmacyId` — обязателен для `pharmacist`
   * (EP-03 связь с конкретной аптекой), `null` для остальных ролей.
   * Опционален в порту, чтобы не ломать существующих потребителей
   * (findOrCreateByTenantAndPhone в VerifyOtp/Telegram use case'ах —
   * для `customer` `pharmacyId` всегда null).
   */
  readonly pharmacyId?: string | null
  /** [DTJ-030, SRS-API-035] `chainId` — обязателен для `pharmacist`/`courier` собственного флота. */
  readonly chainId?: string | null
}

export interface UpdateUserPatch {
  readonly fullName: string | null
  readonly preferredLocale: string | null
  readonly telegramChatId: bigint | null
}

export interface UsersRepository {
  findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null>
  findById(id: string): Promise<User | null>
  create(input: CreateUserInput): Promise<User>
  findOrCreateByTenantAndPhone(input: CreateUserInput): Promise<User>
  /**
   * [Task 5, handoff §6] Глобальный поиск пользователя по `phoneNumber`.
   * Используется ТОЛЬКО в `VerifyOtpUseCase` для логина — после verify OTP
   * пользователь «предъявляет» телефон + одноразовый код; в этой точке
   * tenant-isolation уже снята через факт владения кодом. Если один и тот
   * же `phoneNumber` встречается в нескольких тенантах (multi-tenant
   * White-Label), возвращаем ПЕРВОГО активного (детерминированный порядок
   * по `created_at`); в R1 такая ситуация невозможна по `create_staff_account`
   * политике (admin не может создать двух пользователей с одним phone в
   * своём тенанте), но всё равно обрабатывается явно.
   *
   * НЕ использовать вне `VerifyOtpUseCase` — этот порт нарушает
   * tenant-isolation и обязан быть оправдан identity-claim'ом (OTP-код).
   */
  findActiveByPhone(phoneNumber: string): Promise<User | null>
  update(id: string, patch: UpdateUserPatch): Promise<User>
}
