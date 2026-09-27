// Дедлайн ротации проверяется здесь же (defense-in-depth), не только через RevokeExpiredRotatedKeysJob.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import * as argon2 from 'argon2'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import type Redis from 'ioredis'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import { pharmacyApiKeys } from '@/db/schema/pharmacy-api-keys.js'
import {
  PHARMACY_API_KEY_VERIFICATION,
  type PharmacyApiKeyVerificationInput,
  type PharmacyApiKeyVerificationPort,
  type PharmacyApiKeyVerificationResult,
} from '@/modules/inventory/application/ports/pharmacy-api-key-verification.port.js'
import {
  MtlsRequiredError,
  PharmacyApiKeyInvalidError,
  PharmacyRequestReplayedError,
  PharmacySignatureInvalidError,
  PharmacyTimestampOutOfWindowError,
} from '@dorutj/contracts'

const DEFAULT_SIGNATURE_WINDOW_SECONDS = 300
const NONCE_KEY_PREFIX = 'pharmacy_nonce'
const NONCE_MARKER_VALUE = '1'
const MTLS_SUCCESS_HEADER_VALUE = 'SUCCESS'

interface ResolvedKeyRow {
  readonly id: string
  readonly pharmacyId: string
  readonly chainId: string | null
  readonly keyHash: string
}

@Injectable()
export class DrizzlePharmacyApiKeyVerificationAdapter implements PharmacyApiKeyVerificationPort {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async verify(input: PharmacyApiKeyVerificationInput): Promise<PharmacyApiKeyVerificationResult> {
    const key = await this.resolveVerifiedKey(input)
    this.assertTimestampWithinWindow(input)
    await this.assertNonceNotReplayed(key, input)
    this.assertSignatureValid(input)
    void this.touchLastUsedAt(key.id)
    return { pharmacyId: key.pharmacyId, chainId: key.chainId }
  }

  private async resolveVerifiedKey(input: PharmacyApiKeyVerificationInput): Promise<ResolvedKeyRow> {
    const rows = await this.db
      .select({
        id: pharmacyApiKeys.id,
        pharmacyId: pharmacyApiKeys.pharmacyId,
        chainId: pharmacyApiKeys.chainId,
        keyHash: pharmacyApiKeys.keyHash,
        requireMtls: pharmacyApiKeys.requireMtls,
        rotationGraceExpiresAt: pharmacyApiKeys.rotationGraceExpiresAt,
      })
      .from(pharmacyApiKeys)
      .where(
        and(
          eq(pharmacyApiKeys.keyPrefix, input.keyId),
          eq(pharmacyApiKeys.isActive, true),
          isNull(pharmacyApiKeys.revokedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    if (row?.pharmacyId == null) {
      throw new PharmacyApiKeyInvalidError()
    }
    if (row.rotationGraceExpiresAt !== null && row.rotationGraceExpiresAt.getTime() <= Date.now()) {
      throw new PharmacyApiKeyInvalidError()
    }
    let secretMatches: boolean
    try {
      secretMatches = await argon2.verify(row.keyHash, input.secret)
    } catch {
      secretMatches = false
    }
    if (!secretMatches) {
      throw new PharmacyApiKeyInvalidError()
    }
    if (row.requireMtls && input.mtlsVerifiedHeader !== MTLS_SUCCESS_HEADER_VALUE) {
      throw new MtlsRequiredError()
    }
    return { id: row.id, pharmacyId: row.pharmacyId, chainId: row.chainId, keyHash: row.keyHash }
  }

  private assertTimestampWithinWindow(input: PharmacyApiKeyVerificationInput): void {
    const nowSec = Math.floor(Date.now() / 1000)
    const ts = Number.parseInt(input.timestamp, 10)
    if (Number.isNaN(ts) || Math.abs(nowSec - ts) > DEFAULT_SIGNATURE_WINDOW_SECONDS) {
      throw new PharmacyTimestampOutOfWindowError()
    }
  }

  private async assertNonceNotReplayed(
    key: ResolvedKeyRow,
    input: PharmacyApiKeyVerificationInput,
  ): Promise<void> {
    const nonceKey = `${NONCE_KEY_PREFIX}:${key.pharmacyId}:${input.nonce}`
    const acquired = await this.redis.set(
      nonceKey,
      NONCE_MARKER_VALUE,
      'EX',
      DEFAULT_SIGNATURE_WINDOW_SECONDS,
      'NX',
    )
    if (acquired === null) {
      throw new PharmacyRequestReplayedError()
    }
  }

  private assertSignatureValid(input: PharmacyApiKeyVerificationInput): void {
    const bodyHash = createHash('sha256').update(input.rawBody).digest('hex')
    const canonical = `${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`
    const expected = createHmac('sha256', input.secret).update(canonical).digest('hex')
    let provided: Buffer
    try {
      provided = Buffer.from(input.signature, 'hex')
    } catch {
      throw new PharmacySignatureInvalidError()
    }
    const expectedBuffer = Buffer.from(expected, 'hex')
    if (provided.length !== expectedBuffer.length) {
      throw new PharmacySignatureInvalidError()
    }
    if (!timingSafeEqual(provided, expectedBuffer)) {
      throw new PharmacySignatureInvalidError()
    }
  }

  /** Best-effort — ошибка здесь не должна ронять успешную верификацию. */
  private async touchLastUsedAt(keyId: string): Promise<void> {
    try {
      await this.db.update(pharmacyApiKeys).set({ lastUsedAt: new Date() }).where(eq(pharmacyApiKeys.id, keyId))
    } catch {
      // no-op
    }
  }
}

export const PHARMACY_API_KEY_VERIFICATION_DRIZZLE_PROVIDER = {
  provide: PHARMACY_API_KEY_VERIFICATION,
  useClass: DrizzlePharmacyApiKeyVerificationAdapter,
} as const
