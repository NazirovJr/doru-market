// Подписывает тем же RS256-ключом, что и бэкенд (E2E_JWT_PRIVATE_KEY, ENV — не хардкод).
// Ручная сборка JWT, не библиотека jsonwebtoken — она не объявлена зависимостью пакета.
import { createSign, randomUUID } from 'node:crypto'

export interface ExpiredTokenClaims {
  readonly sub: string
  readonly role: string
  readonly tenantId: string | null
  readonly pharmacyId?: string | null
  readonly chainId?: string | null
  readonly sessionId?: string | null
}

const SECONDS_PER_MINUTE = 60
const EXPIRED_MINUTES_AGO = 20
const ISSUED_MINUTES_BEFORE_EXPIRY = 15

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '')
}

// Токен, синтаксически идентичный боевому, но с exp в прошлом (подпись валидна, просрочен только срок).
export function signExpiredAccessToken(claims: ExpiredTokenClaims, privateKeyPem: string, kid = 'v1'): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
  const nowSeconds = Math.floor(Date.now() / 1000)
  const exp = nowSeconds - EXPIRED_MINUTES_AGO * SECONDS_PER_MINUTE
  const iat = exp - ISSUED_MINUTES_BEFORE_EXPIRY * SECONDS_PER_MINUTE
  const payload = base64url(
    JSON.stringify({
      sub: claims.sub,
      role: claims.role,
      tenantId: claims.tenantId,
      pharmacyId: claims.pharmacyId ?? null,
      chainId: claims.chainId ?? null,
      sessionId: claims.sessionId ?? null,
      iat,
      exp,
      jti: randomUUID(),
    }),
  )
  const signingInput = `${header}.${payload}`
  const signature = base64url(createSign('RSA-SHA256').update(signingInput).end().sign(privateKeyPem))
  return `${signingInput}.${signature}`
}
