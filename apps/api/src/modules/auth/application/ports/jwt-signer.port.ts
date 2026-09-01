/**
 * `JwtClaims` + `JwtSignerPort` (EP-01, DTJ-022).
 *
 * JWT-claims согласно SRS-API-024:
 *   - `sub`        — `userId`
 *   - `role`       — одна из 6 ролей (`UserRole` из `packages/contracts/src/permissions`)
 *   - `tenantId`   — UUID тенанта, `null` для `super_admin`
 *   - `pharmacyId` — UUID аптеки, `null` для всех, кроме привязанных к аптеке
 *   - `chainId`    — UUID сети, `null` для всех, кроме привязанных к сети
 *   - `sessionId`  — `auth_sessions.id` (вводится в DTJ-024; пока = `jti` ниже)
 *   - `iat`/`exp`/`jti` — управляются библиотекой подписи, НЕ часть входного объекта порта
 *
 * `iat`/`exp` — стандартные JWT claims, выставляются самой подписью (`@nestjs/jwt`).
 * `jti` — генерируется адаптером, чтобы каждая выдача токена была уникальна
 * (нужно для `revoke` механизма в DTJ-026).
 */
import { type Result } from '@dorutj/domain-kernel'
import { type UserRole } from '@dorutj/contracts'

/** DI-токен для `JwtSignerPort` (NestJS, EP-01 DTJ-022). */
export const JWT_SIGNER = Symbol.for('@dorutj/auth/jwt-signer')

export interface JwtClaims {
  readonly sub: string
  readonly role: UserRole
  readonly tenantId: string | null
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly sessionId: string
}

export class JwtVerificationError extends Error {
  constructor(
    readonly code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'INVALID_SIGNATURE',
    message: string,
  ) {
    super(message)
    this.name = 'JwtVerificationError'
  }
}

export interface JwtSignerPort {
  sign(claims: JwtClaims): string
  verify(token: string): Result<JwtClaims, JwtVerificationError>
}
