/**
 * `InMemoryAuthSessionsRepository` (EP-01, DTJ-024/025/026) — заглушка для R1.
 *
 * Drizzle-реализация появится, когда БД подключится (STATE-AND-RESUME §5.1).
 * Контракт уже совместим с Drizzle: `tx`-параметр во всех `revoke*`-методах
 * уже Drizzle-готов (для будущего `db.transaction(...)` без изменения
 * сигнатур use case). В InMemory-режиме `tx` игнорируется — Map-операции
 * синхронны и атомарны в однопоточном Node.js.
 */
import { Injectable } from '@nestjs/common'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
  type RevokeReason,
  type RotateAuthSessionInput,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'

@Injectable()
export class InMemoryAuthSessionsRepository implements AuthSessionsRepository {
  private readonly byId = new Map<string, AuthSession>()
  private readonly byRefreshHash = new Map<string, AuthSession>()

  async create(input: CreateAuthSessionInput): Promise<AuthSession> {
    const session = AuthSession.restore({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId: input.id, // первая сессия цепочки (DTJ-024 §3.6)
      refreshTokenHash: input.refreshTokenHash,
      deviceLabel: input.deviceLabel,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      absoluteExpiresAt: input.absoluteExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: input.createdAt, // DTJ-026: инициализируется равным created_at
      createdAt: input.createdAt,
    })
    this.byId.set(session.id, session)
    this.byRefreshHash.set(session.refreshTokenHash, session)
    return Promise.resolve(session)
  }

  async findById(id: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byId.get(id) ?? null)
  }

  async findByRefreshHash(hash: string): Promise<AuthSession | null> {
    return Promise.resolve(this.byRefreshHash.get(hash) ?? null)
  }

  async findActiveByUserId(userId: string, now: Date): Promise<readonly AuthSession[]> {
    // [DTJ-026 §3.3] «active» = не revoked, не rotated (одна строка на устройство,
    // rotation создаёт НОВУЮ запись, а не обновляет старую).
    const result: AuthSession[] = []
    for (const session of this.byId.values()) {
      if (
        session.userId === userId &&
        session.revokedAt === null &&
        session.rotatedAt === null &&
        session.absoluteExpiresAt.getTime() > now.getTime()
      ) {
        result.push(session)
      }
    }
    return Promise.resolve(result)
  }

   
  async revokeCurrentAndCreateNext(
    _tx: UnitOfWorkTx,
    previousId: string,
    input: RotateAuthSessionInput,
  ): Promise<AuthSession> {
    const previous = this.byId.get(previousId)
    if (previous === undefined) {
      throw new Error(`AuthSession not found: ${previousId} (DTJ-025 revokeCurrentAndCreateNext)`)
    }
    // Шаг 1: пометить текущую строку `rotated_at = now()`. ВАЖНО: не удаляем
    // запись — она нужна для detect-reuse detection (SRS-API-027) и для
    // отладки. Также обновляем `last_seen_at` (DTJ-026: «обращение к сессии»).
    const rotatedPrevious = AuthSession.restore({
      ...previous.props,
      rotatedAt: input.now,
      lastSeenAt: input.now,
    })
    this.byId.set(previousId, rotatedPrevious)
    // Переиндексируем: refresh_token_hash для предыдущей записи остаётся
    // (для detect-reuse); новая запись получает свой ключ.
    this.byRefreshHash.set(rotatedPrevious.refreshTokenHash, rotatedPrevious)

    // Шаг 2: создать новую запись с тем же familyId, скопированным
    // absoluteExpiresAt (SRS-API-025: НЕ продлевается), новым refreshTokenHash.
    const next = AuthSession.restore({
      id: input.nextId,
      tenantId: input.tenantId,
      userId: input.userId,
      familyId: input.familyId,
      refreshTokenHash: input.newRefreshTokenHash,
      deviceLabel: input.deviceLabel,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      absoluteExpiresAt: input.absoluteExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: input.now,
      createdAt: input.now,
    })
    this.byId.set(next.id, next)
    this.byRefreshHash.set(next.refreshTokenHash, next)
    return Promise.resolve(next)
  }

   
  async revokeAllByFamilyId(
    _tx: UnitOfWorkTx,
    familyId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<number> {
    let revokedCount = 0
    for (const session of this.byId.values()) {
      if (session.familyId === familyId && session.revokedAt === null) {
        const revoked = AuthSession.restore({
          ...session.props,
          revokedAt: now,
          revokeReason: reason,
        })
        this.byId.set(session.id, revoked)
        // Очищаем byRefreshHash: revoked сессия не должна находиться по
        // refresh-хешу (Drizzle-реализация делает то же самое в транзакции).
        if (this.byRefreshHash.get(session.refreshTokenHash)?.id === session.id) {
          this.byRefreshHash.delete(session.refreshTokenHash)
        }
        revokedCount += 1
      }
    }
    return Promise.resolve(revokedCount)
  }

   
  async revokeOneById(
    _tx: UnitOfWorkTx,
    sessionId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<number> {
    const session = this.byId.get(sessionId)
    if (session === undefined || session.revokedAt !== null) {
      // Идемпотентный путь: 0 = либо не существует, либо уже revoked. Не
      // раскрываем причину подробнее (logout чужой сессии / повторный logout
      // / logout несуществующей — все дают 0, без раскрытия).
      return Promise.resolve(0)
    }
    const revoked = AuthSession.restore({
      ...session.props,
      revokedAt: now,
      revokeReason: reason,
    })
    this.byId.set(sessionId, revoked)
    if (this.byRefreshHash.get(session.refreshTokenHash)?.id === sessionId) {
      this.byRefreshHash.delete(session.refreshTokenHash)
    }
    return Promise.resolve(1)
  }

   
  async revokeAllByUserId(
    _tx: UnitOfWorkTx,
    userId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<number> {
    let revokedCount = 0
    for (const session of this.byId.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        const revoked = AuthSession.restore({
          ...session.props,
          revokedAt: now,
          revokeReason: reason,
        })
        this.byId.set(session.id, revoked)
        if (this.byRefreshHash.get(session.refreshTokenHash)?.id === session.id) {
          this.byRefreshHash.delete(session.refreshTokenHash)
        }
        revokedCount += 1
      }
    }
    return Promise.resolve(revokedCount)
  }
}

export { AUTH_SESSIONS_REPOSITORY }
