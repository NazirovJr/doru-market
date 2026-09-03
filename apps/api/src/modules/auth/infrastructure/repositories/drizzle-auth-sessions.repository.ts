/**
 * Drizzle `AuthSessionsRepository` (EP-01, DTJ-024/025/026, волна 5 блок A).
 *
 * Подключается вместо `InMemoryAuthSessionsRepository`, когда доступна
 * Postgres. Методы `revoke*`/`revokeCurrentAndCreateNext`/`create` принимают
 * ОПЦИОНАЛЬНЫЙ `tx` из `UnitOfWorkPort.run(...)` — используют его через
 * `resolveDrizzleClient`, чтобы запись строк была частью той же транзакции,
 * что и вызывающий use case (`RefreshTokenUseCase`, `LogoutUseCase`,
 * `LogoutAllUseCase`, `RevokeSessionUseCase`, `VerifyOtpUseCase`). `create`
 * — волна 6 (self-deadlock пула соединений, тот же дефект, что чинили в
 * checkout DTJ-231/233): `VerifyOtpUseCase.createSession` вызывается ВНУТРИ
 * `uow.run`, без `tx` здесь `create` просило бы у пула ВТОРОЕ соединение
 * поверх уже удержанного. `TelegramAuthUseCase.issueTokens` вызывает `create`
 * БЕЗ `tx` (намеренно вне транзакции) — резолвится на `this.db`, как раньше.
 * `findById`/`findByRefreshHash`/`findActiveByUserId` не принимают `tx`
 * (порт не даёт — см. JSDoc `AuthSessionsRepository`), всегда на `this.db`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { authSessions, type AuthSessionRow } from '@/db/schema/auth-sessions.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
  type CreateAuthSessionInput,
  type RevokeReason,
  type RotateAuthSessionInput,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleAuthSessionsRepository implements AuthSessionsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(input: CreateAuthSessionInput, tx?: UnitOfWorkTx): Promise<AuthSession> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .insert(authSessions)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        userId: input.userId,
        familyId: input.id, // первая сессия цепочки (DTJ-024 §3.6)
        refreshTokenHash: input.refreshTokenHash,
        deviceLabel: input.deviceLabel,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        absoluteExpiresAt: input.absoluteExpiresAt,
        lastSeenAt: input.createdAt, // DTJ-026: инициализируется равным created_at
        createdAt: input.createdAt,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) {
      throw new Error('auth_sessions insert returned no rows')
    }
    return rowToDomain(row)
  }

  async findById(id: string): Promise<AuthSession | null> {
    const rows = await this.db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToDomain(row)
  }

  async findByRefreshHash(hash: string): Promise<AuthSession | null> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.refreshTokenHash, hash))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToDomain(row)
  }

  async findActiveByUserId(userId: string, now: Date): Promise<readonly AuthSession[]> {
    // [DTJ-026 §3.3] «active» = не revoked, не rotated, не истёк по absolute_expires_at.
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          isNull(authSessions.rotatedAt),
          gt(authSessions.absoluteExpiresAt, now),
        ),
      )
    return rows.map(rowToDomain)
  }

  /**
   * Атомарная refresh-rotation (DTJ-025 §2.6): `UPDATE previous SET
   * rotated_at/last_seen_at` + `INSERT` новой строки с тем же `family_id`.
   * Оба запроса — на `tx`, полученном из `uow.run` (одна транзакция).
   */
  async revokeCurrentAndCreateNext(
    tx: UnitOfWorkTx,
    previousId: string,
    input: RotateAuthSessionInput,
  ): Promise<AuthSession> {
    const client = resolveDrizzleClient(this.db, tx)
    const updatedPrevious = await client
      .update(authSessions)
      .set({ rotatedAt: input.now, lastSeenAt: input.now })
      .where(eq(authSessions.id, previousId))
      .returning({ id: authSessions.id })
    if (updatedPrevious[0] === undefined) {
      throw new Error(`AuthSession not found: ${previousId} (DTJ-025 revokeCurrentAndCreateNext)`)
    }
    const inserted = await client
      .insert(authSessions)
      .values({
        id: input.nextId,
        tenantId: input.tenantId,
        userId: input.userId,
        familyId: input.familyId,
        refreshTokenHash: input.newRefreshTokenHash,
        deviceLabel: input.deviceLabel,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        absoluteExpiresAt: input.absoluteExpiresAt,
        lastSeenAt: input.now,
        createdAt: input.now,
      })
      .returning()
    const row = inserted[0]
    if (row === undefined) {
      throw new Error('auth_sessions insert returned no rows (revokeCurrentAndCreateNext)')
    }
    return rowToDomain(row)
  }

  async revokeAllByFamilyId(input: {
    tx: UnitOfWorkTx
    familyId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    const client = resolveDrizzleClient(this.db, input.tx)
    const rows = await client
      .update(authSessions)
      .set({ revokedAt: input.now, revokeReason: input.reason })
      .where(and(eq(authSessions.familyId, input.familyId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id })
    return rows.length
  }

  async revokeOneById(input: {
    tx: UnitOfWorkTx
    sessionId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    const client = resolveDrizzleClient(this.db, input.tx)
    const rows = await client
      .update(authSessions)
      .set({ revokedAt: input.now, revokeReason: input.reason })
      .where(and(eq(authSessions.id, input.sessionId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id })
    return rows.length
  }

  async revokeAllByUserId(input: {
    tx: UnitOfWorkTx
    userId: string
    reason: RevokeReason
    now: Date
  }): Promise<number> {
    const client = resolveDrizzleClient(this.db, input.tx)
    const rows = await client
      .update(authSessions)
      .set({ revokedAt: input.now, revokeReason: input.reason })
      .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id })
    return rows.length
  }
}

function rowToDomain(row: AuthSessionRow): AuthSession {
  return AuthSession.restore({
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    familyId: row.familyId,
    refreshTokenHash: row.refreshTokenHash,
    deviceLabel: row.deviceLabel,
    userAgent: row.userAgent,
    ipAddress: row.ipAddress,
    absoluteExpiresAt: toDate(row.absoluteExpiresAt),
    rotatedAt: row.rotatedAt === null ? null : toDate(row.rotatedAt),
    revokedAt: row.revokedAt === null ? null : toDate(row.revokedAt),
    revokeReason: row.revokeReason,
    lastSeenAt: toDate(row.lastSeenAt),
    createdAt: toDate(row.createdAt),
  })
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export { AUTH_SESSIONS_REPOSITORY }
