/**
 * `InMemoryUserTelegramIdentitiesRepository` (EP-01, DTJ-027) — заглушка
 * для R1. Drizzle-реализация появится вместе с подключением БД.
 *
 * Дедупликация: на уровне Map-а НЕ делаем UNIQUE-constraint — на это есть
 * UNIQUE INDEX `unique_telegram_user_per_tenant` в БД. В Drizzle-режиме
 * конфликт (23505) будет обработан в use case как «уже существует» →
 * `findByTenantAndTelegramId` ещё раз.
 */
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  USER_TELEGRAM_IDENTITIES_REPOSITORY,
  type CreateUserTelegramIdentityInput,
  type UserTelegramIdentitiesRepository,
  type UserTelegramIdentity,
} from '@/modules/auth/application/ports/user-telegram-identities.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'

@Injectable()
export class InMemoryUserTelegramIdentitiesRepository implements UserTelegramIdentitiesRepository {
  /** Ключ: `${tenantId}|${telegramUserId.toString()}` (bigint → string для ключа). */
  private readonly byTenantTelegram = new Map<string, UserTelegramIdentity>()

   
  async findByTenantAndTelegramId(
    tenantId: string,
    telegramUserId: bigint,
    _tx?: UnitOfWorkTx,
  ): Promise<UserTelegramIdentity | null> {
    const found = this.byTenantTelegram.get(`${tenantId}|${telegramUserId.toString()}`)
    return Promise.resolve(found ?? null)
  }

   
  async create(
    input: CreateUserTelegramIdentityInput,
    _tx?: UnitOfWorkTx,
  ): Promise<UserTelegramIdentity> {
    const id = randomUUID()
    const identity: UserTelegramIdentity = { id, ...input }
    this.byTenantTelegram.set(
      `${input.tenantId}|${input.telegramUserId.toString()}`,
      identity,
    )
    return Promise.resolve(identity)
  }
}

export { USER_TELEGRAM_IDENTITIES_REPOSITORY }
