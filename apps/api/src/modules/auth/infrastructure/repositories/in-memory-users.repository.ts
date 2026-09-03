/**
 * In-memory `UsersRepository` (EP-01, DTJ-022) — заглушка.
 *
 * Drizzle-реализация появится в рамках DTJ-024 (VerifyOtp). R1: InMemory
 * достаточно для сборки auth-каркаса (EP-01 закрыт, авторизация в рантайме работает).
 */
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  USERS_REPOSITORY,
  type CreateUserInput,
  type UpdateUserPatch,
  type UsersRepository,
} from '@/modules/auth/application/ports/users.repository.port.js'
import { type User } from '@/modules/auth/domain/user.js'

@Injectable()
export class InMemoryUsersRepository implements UsersRepository {
  private readonly byId = new Map<string, User>()
  private readonly tenantPhoneIndex = new Map<string, string>()

  // `tx?` игнорируется — InMemory-режим атомарен по синхронности `Map` (см. JSDoc порта).
  async findByTenantAndPhone(tenantId: string, phoneNumber: string): Promise<User | null> {
    const id = this.tenantPhoneIndex.get(`${tenantId}|${phoneNumber}`)
    if (id === undefined) {
      return Promise.resolve(null)
    }
    const user = this.byId.get(id)
    if (user?.deletedAt === null) {
      return Promise.resolve(user)
    }
    return Promise.resolve(null)
  }

  async findById(id: string): Promise<User | null> {
    const user = this.byId.get(id)
    if (user?.deletedAt === null) {
      return Promise.resolve(user)
    }
    return Promise.resolve(null)
  }

  /**
   * [Task 5, handoff §6] Глобальный поиск по phone — см. JSDoc в port.
   * Возвращает первого активного пользователя с указанным телефоном,
   * детерминированно по `createdAt`. В тестовых сценариях хватает
   * одного совпадения — admin создаёт уникальных пользователей на
   * уникальные телефоны в своём тенанте.
   */
  async findActiveByPhone(phoneNumber: string): Promise<User | null> {
    let earliest: User | null = null
    for (const user of this.byId.values()) {
      if (user.deletedAt !== null) continue
      if (user.phoneNumber !== phoneNumber) continue
      if (earliest === null || user.createdAt < earliest.createdAt) {
        earliest = user
      }
    }
    return Promise.resolve(earliest)
  }

  async create(input: CreateUserInput): Promise<User> {
    const id = randomUUID()
    const now = new Date()
    const user: User = {
      id,
      tenantId: input.tenantId,
      phoneNumber: input.phoneNumber,
      role: input.role,
      fullName: input.fullName,
      // [DTJ-030] `pharmacyId`/`chainId` пробрасываются из входа. Дефолт `null`
      // сохранён для обратной совместимости с потребителями, не передающими эти
      // поля (VerifyOtpUseCase/TelegramAuthUseCase — там всегда null).
      pharmacyId: input.pharmacyId ?? null,
      chainId: input.chainId ?? null,
      telegramChatId: null,
      preferredLocale: 'tj',
      isActive: true,
      createdAt: now,
      deletedAt: null,
    }
    this.byId.set(id, user)
    this.tenantPhoneIndex.set(`${input.tenantId}|${String(input.phoneNumber)}`, id)
    return Promise.resolve(user)
  }

  /**
   * Атомарный find-or-create (DTJ-024). В InMemory-режиме sequential
   * find→create безопасен (Map синхронен, однопоточная модель Node.js).
   * Drizzle-реализация использует `INSERT ... ON CONFLICT DO NOTHING RETURNING *`
   * + `SELECT` в одной транзакции.
   */
  async findOrCreateByTenantAndPhone(input: CreateUserInput): Promise<User> {
    if (input.phoneNumber === null) {
      // Телеграм-путь: phone отсутствует, создаём нового пользователя сразу.
      return this.create(input)
    }
    const existing = await this.findByTenantAndPhone(input.tenantId, input.phoneNumber)
    if (existing !== null) {
      return existing
    }
    return this.create(input)
  }

  async update(id: string, patch: UpdateUserPatch): Promise<User> {
    const existing = this.byId.get(id)
    if (existing === undefined) {
      throw new Error(`user not found: ${id}`)
    }
    const updated: User = {
      ...existing,
      fullName: patch.fullName,
      preferredLocale: patch.preferredLocale ?? existing.preferredLocale,
      telegramChatId: patch.telegramChatId,
    }
    this.byId.set(id, updated)
    return Promise.resolve(updated)
  }
}

export { USERS_REPOSITORY }
