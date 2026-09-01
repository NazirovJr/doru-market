/**
 * `Rs256JwtSignerAdapter` (EP-01, DTJ-022) — JWT RS256 (асимметричный).
 *
 * Контракт SRS-API-024:
 *   - `algorithm: 'RS256'`, `expiresIn: 15 минут`
 *   - `kid: JWT_KID` в заголовке (задел на ротацию, см. DTJ-022 §«Риски»)
 *   - claims: `sub`, `role`, `tenantId`, `pharmacyId`, `chainId`, `sessionId`,
 *     `iat`/`exp`/`jti` (управляются библиотекой)
 *
 * Конфигурация (ENV, через `env.schema.ts` из DTJ-001):
 *   - `JWT_PRIVATE_KEY` (PEM, многострочный) — закрытый ключ RS256
 *   - `JWT_PUBLIC_KEY`  (PEM, многострочный) — открытый ключ RS256
 *   - `JWT_KID`         (string, дефолт `'v1'`) — key id
 *
 * Ротация ключа (`kid`): в заголовке присутствует, но `verify` принимает
 * ТОЛЬКО текущий `JWT_PUBLIC_KEY` (полноценная многоключевая верификация
 * с несколькими активными `kid` — follow-up, не входит в R1, см. §«Риски»).
 */
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { JwtClaims, JwtSignerPort, JwtVerificationError } from '@/modules/auth/application/ports/jwt-signer.port.js'

const ACCESS_TOKEN_EXPIRES_MINUTES = 15
const SECONDS_PER_MINUTE = 60

interface JsonWebTokenErrorLike {
  readonly name: string
  readonly message: string
}
function isExpiredError(e: unknown): e is JsonWebTokenErrorLike {
  return e instanceof Error && e.name === 'TokenExpiredError'
}
function isJsonWebTokenError(e: unknown): e is JsonWebTokenErrorLike {
  return e instanceof Error && e.name === 'JsonWebTokenError'
}

interface AdapterConfig {
  readonly privateKey: string
  readonly publicKey: string
  readonly kid: string
  readonly expiresInSeconds: number
}

@Injectable()
export class Rs256JwtSignerAdapter implements JwtSignerPort {
  private readonly jwtService: JwtService

  constructor() {
    const config = this.readConfig()
    this.jwtService = new JwtService({
      privateKey: config.privateKey,
      publicKey: config.publicKey,
      signOptions: {
        algorithm: 'RS256',
        expiresIn: config.expiresInSeconds,
        header: { kid: config.kid, alg: 'RS256' },
      },
      verifyOptions: {
        algorithms: ['RS256'],
      },
    })
  }

  sign(claims: JwtClaims): string {
    // `sub`, `iat`/`exp` — стандартные claim'ы JWT, `@nestjs/jwt` принимает
    // произвольные поля и подмешивает к payload'у.
    return this.jwtService.sign(claims)
  }

  verify(token: string): Result<JwtClaims, JwtVerificationError> {
    try {
      const decoded = this.jwtService.verify<JwtClaims & { iat: number; exp: number; jti: string }>(token)
      return ok({
        sub: decoded.sub,
        role: decoded.role,
        tenantId: decoded.tenantId,
        pharmacyId: decoded.pharmacyId,
        chainId: decoded.chainId,
        sessionId: decoded.sessionId,
      })
    } catch (e: unknown) {
      if (isExpiredError(e)) {
        return err(new JwtVerificationError('TOKEN_EXPIRED', 'jwt expired'))
      }
      if (isJsonWebTokenError(e)) {
        const message = e.message
        if (message.includes('signature') || message.includes('invalid')) {
          return err(new JwtVerificationError('INVALID_SIGNATURE', message))
        }
        return err(new JwtVerificationError('TOKEN_INVALID', message))
      }
      const message = e instanceof Error ? e.message : 'unknown verification error'
      return err(new JwtVerificationError('TOKEN_INVALID', message))
    }
  }

  private readConfig(): AdapterConfig {
    const privateKey = process.env.JWT_PRIVATE_KEY
    const publicKey = process.env.JWT_PUBLIC_KEY
    if (privateKey === undefined || privateKey === '') {
      throw new Error('JWT_PRIVATE_KEY is not set (EP-01, DTJ-022)')
    }
    if (publicKey === undefined || publicKey === '') {
      throw new Error('JWT_PUBLIC_KEY is not set (EP-01, DTJ-022)')
    }
    const kid = process.env.JWT_KID ?? 'v1'
    return {
      privateKey,
      publicKey,
      kid,
      expiresInSeconds: ACCESS_TOKEN_EXPIRES_MINUTES * SECONDS_PER_MINUTE,
    }
  }
}
