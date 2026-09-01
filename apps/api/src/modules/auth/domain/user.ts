/**
 * Доменный тип `User` (EP-01, DTJ-022, DTJ-014).
 *
 * Тонкий DTO маппинга строки `users` БД → доменное представление.
 * НЕ полноценный rich-агрегат: SRS-API-017 + `10-domain-model.md` НЕ описывают
 * `User` как агрегат со сложными инвариантами, только как сущность
 * идентичности. Методы-намерения не нужны сверх того, что валидируют
 * VO при создании (DTJ-014 §«Что сделать» п.3).
 */
import { type UserRole } from '@dorutj/contracts'

export interface User {
  readonly id: string
  readonly tenantId: string
  /**
   * [DTJ-027, SRS-API-031] NULLABLE: Telegram-путь первого входа (без
   * телефона) — `phoneNumber = null`. OTP-путь (DTJ-022/023/024) — всегда
   * непустая строка. Снятие `NOT NULL` — см. миграцию `0007_users_phone_nullable.sql`.
   */
  readonly phoneNumber: string | null
  readonly role: UserRole
  readonly fullName: string | null
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly telegramChatId: bigint | null
  readonly preferredLocale: string
  readonly isActive: boolean
  readonly createdAt: Date
  readonly deletedAt: Date | null
}
