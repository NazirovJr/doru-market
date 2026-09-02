/**
 * Тест `PharmacyApiKeyGuard` (EP-05, DTJ-156, SRS-API-033).
 */
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type Redis from 'ioredis'
import { InMemoryPharmacyApiKeyVerificationAdapter } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-api-key-verification.adapter.js'
import { PharmacyApiKeyGuard, type FastifyRequestWithPrincipal } from './pharmacy-api-key.guard.js'
import { createHash, createHmac } from 'node:crypto'

function makeContext(
  headers: Record<string, string | undefined>,
  body: string,
  route: { method?: string; path?: string } = {},
): ExecutionContext {
  const { method = 'POST', path = '/api/v1/inventory/batch-update' } = route
  const rawBody = Buffer.from(body, 'utf-8')
  const req = {
    method,
    url: path,
    headers,
    rawBody,
    principal: undefined,
  } as never
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext
}

function makeVerifier(): InMemoryPharmacyApiKeyVerificationAdapter {
  // Тест-мок: in-memory адаптер не использует переданный коннектор (тест работает в полностью автономной фейк-БД).
  return new InMemoryPharmacyApiKeyVerificationAdapter({} as unknown as Redis)
}

function signRequest(input: {
  keyId: string
  secret: string
  timestamp: string
  nonce: string
  method: string
  path: string
  body: string
}): string {
  const bodyHash = createHash('sha256').update(input.body, 'utf-8').digest('hex')
  const canonical = `${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`
  return createHmac('sha256', input.secret).update(canonical).digest('hex')
}

describe('PharmacyApiKeyGuard (DTJ-156, SRS-API-033)', () => {
  it('корректные keyId/secret/signature → request.principal установлен', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-1',
      secretPlain: 's-1',
      pharmacyId: 'P-1',
      chainId: null,
      requireMtls: false,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'n-1'
    const body = '{"pharmacyId":"P-1"}'
    const sig = signRequest({
      keyId: 'k-1',
      secret: 's-1',
      timestamp: ts,
      nonce,
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body,
    })
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'k-1.s-1',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      body,
    )
    const req = ctx.switchToHttp().getRequest<FastifyRequestWithPrincipal>()
    expect(await guard.canActivate(ctx)).toBe(true)
    expect(req.principal).toEqual({
      type: 'pharmacy_system',
      pharmacyId: 'P-1',
      chainId: null,
    })
  })

  it('timestamp на 10 минут в прошлом → 401', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-1',
      secretPlain: 's-1',
      pharmacyId: 'P-1',
      chainId: null,
      requireMtls: false,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000) - 600)
    const body = '{}'
    const sig = signRequest({
      keyId: 'k-1',
      secret: 's-1',
      timestamp: ts,
      nonce: 'n-1',
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body,
    })
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'k-1.s-1',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': 'n-1',
        'x-pharmacy-signature': sig,
      },
      body,
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('тот же nonce дважды → replay', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-1',
      secretPlain: 's-1',
      pharmacyId: 'P-1',
      chainId: null,
      requireMtls: false,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'n-replay'
    const body = '{}'
    const sig = signRequest({
      keyId: 'k-1',
      secret: 's-1',
      timestamp: ts,
      nonce,
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body,
    })
    const ctx1 = makeContext(
      {
        'x-pharmacy-api-key': 'k-1.s-1',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      body,
    )
    await guard.canActivate(ctx1)
    const ctx2 = makeContext(
      {
        'x-pharmacy-api-key': 'k-1.s-1',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      body,
    )
    await expect(guard.canActivate(ctx2)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('тело подписано, но изменено ПОСЛЕ подписи → 401', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-1',
      secretPlain: 's-1',
      pharmacyId: 'P-1',
      chainId: null,
      requireMtls: false,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'n-mitm'
    const signedBody = '{"price":1000}'
    const sig = signRequest({
      keyId: 'k-1',
      secret: 's-1',
      timestamp: ts,
      nonce,
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body: signedBody,
    })
    const tamperedBody = '{"price":1}'
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'k-1.s-1',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      tamperedBody,
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('отсутствует X-Pharmacy-API-Key → 401', async () => {
    const guard = new PharmacyApiKeyGuard(makeVerifier())
    const ctx = makeContext(
      { 'x-pharmacy-timestamp': '0', 'x-pharmacy-nonce': 'n', 'x-pharmacy-signature': 's' },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('невалидный формат keyId (без точки) → 401', async () => {
    const guard = new PharmacyApiKeyGuard(makeVerifier())
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'no-dot-here',
        'x-pharmacy-timestamp': '0',
        'x-pharmacy-nonce': 'n',
        'x-pharmacy-signature': 's',
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('unknown keyId → 401 (не раскрывает существование)', async () => {
    const guard = new PharmacyApiKeyGuard(makeVerifier())
    const ts = String(Math.floor(Date.now() / 1000))
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'unknown.s',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': 'n',
        'x-pharmacy-signature': '0'.repeat(64),
      },
      '{}',
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('chainId из БД → прокидывается в request.principal для контроллера', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-2',
      secretPlain: 's-2',
      pharmacyId: 'P-2',
      chainId: 'C-1',
      requireMtls: false,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'n-chain'
    const body = '{}'
    const sig = signRequest({
      keyId: 'k-2',
      secret: 's-2',
      timestamp: ts,
      nonce,
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body,
    })
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'k-2.s-2',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      body,
    )
    const req = ctx.switchToHttp().getRequest<FastifyRequestWithPrincipal>()
    await guard.canActivate(ctx)
    expect(req.principal?.chainId).toBe('C-1')
  })

  it('require_mtls=true без X-SSL-Client-Verify → 401', async () => {
    const verifier = makeVerifier()
    verifier.seed({
      keyId: 'k-3',
      secretPlain: 's-3',
      pharmacyId: 'P-3',
      chainId: null,
      requireMtls: true,
      revokedAt: null,
    })
    const guard = new PharmacyApiKeyGuard(verifier)
    const ts = String(Math.floor(Date.now() / 1000))
    const nonce = 'n-mtls'
    const body = '{}'
    const sig = signRequest({
      keyId: 'k-3',
      secret: 's-3',
      timestamp: ts,
      nonce,
      method: 'POST',
      path: '/api/v1/inventory/batch-update',
      body,
    })
    const ctx = makeContext(
      {
        'x-pharmacy-api-key': 'k-3.s-3',
        'x-pharmacy-timestamp': ts,
        'x-pharmacy-nonce': nonce,
        'x-pharmacy-signature': sig,
      },
      body,
    )
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
