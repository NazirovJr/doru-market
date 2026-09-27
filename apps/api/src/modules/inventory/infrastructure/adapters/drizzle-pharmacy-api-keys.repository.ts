// `keyPrefix` = первые 8 hex того же секрета — это же `keyId` в X-Pharmacy-API-Key (PharmacyApiKeyGuard).
import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyApiKeys } from '@/db/schema/pharmacy-api-keys.js'
import {
  type CreatedPharmacyApiKey,
  type PharmacyApiKeySummary,
  type PharmacyApiKeysRepository,
  type RotatePharmacyApiKeyParams,
  PHARMACY_API_KEYS_REPOSITORY,
} from '@/modules/inventory/application/ports/pharmacy-api-keys.repository.port.js'

const SECRET_BYTES = 32
const KEY_PREFIX_LENGTH = 8
const MS_PER_HOUR = 3_600_000

const SUMMARY_COLUMNS = {
  id: pharmacyApiKeys.id,
  keyPrefix: pharmacyApiKeys.keyPrefix,
  isActive: pharmacyApiKeys.isActive,
  requireMtls: pharmacyApiKeys.requireMtls,
  createdAt: pharmacyApiKeys.createdAt,
  lastUsedAt: pharmacyApiKeys.lastUsedAt,
  revokedAt: pharmacyApiKeys.revokedAt,
} as const

@Injectable()
export class DrizzlePharmacyApiKeysRepository implements PharmacyApiKeysRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(pharmacyId: string, createdByAdminId: string): Promise<CreatedPharmacyApiKey> {
    const generated = await generateKeyMaterial()
    const [row] = await this.db
      .insert(pharmacyApiKeys)
      .values({ pharmacyId, chainId: null, keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, createdBy: createdByAdminId })
      .returning({ id: pharmacyApiKeys.id, createdAt: pharmacyApiKeys.createdAt })
    if (row === undefined) {
      throw new Error('INSERT INTO pharmacy_api_keys did not return a row')
    }
    return { id: row.id, secret: generated.secret, keyPrefix: generated.keyPrefix, createdAt: row.createdAt }
  }

  async listByPharmacy(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]> {
    return this.db.select(SUMMARY_COLUMNS).from(pharmacyApiKeys).where(eq(pharmacyApiKeys.pharmacyId, pharmacyId))
  }

  async revoke(pharmacyId: string, keyId: string, reason: string): Promise<boolean> {
    const updated = await this.db
      .update(pharmacyApiKeys)
      .set({ isActive: false, revokedAt: new Date(), revokeReason: reason })
      .where(
        and(
          eq(pharmacyApiKeys.id, keyId),
          eq(pharmacyApiKeys.pharmacyId, pharmacyId),
          eq(pharmacyApiKeys.isActive, true),
          isNull(pharmacyApiKeys.revokedAt),
        ),
      )
      .returning({ id: pharmacyApiKeys.id })
    return updated.length > 0
  }

  /** Транзакция: старая строка получает дедлайн грейс-периода, новая — ссылку на неё. */
  async rotate(params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKey | null> {
    return this.db.transaction(async (tx) => {
      const graceDeadline = new Date(Date.now() + params.gracePeriodHours * MS_PER_HOUR)
      const [oldRow] = await tx
        .update(pharmacyApiKeys)
        .set({ rotationGraceExpiresAt: graceDeadline })
        .where(
          and(
            eq(pharmacyApiKeys.id, params.oldKeyId),
            eq(pharmacyApiKeys.pharmacyId, params.pharmacyId),
            eq(pharmacyApiKeys.isActive, true),
            isNull(pharmacyApiKeys.revokedAt),
          ),
        )
        .returning({ id: pharmacyApiKeys.id })
      if (oldRow === undefined) {
        return null
      }
      return insertRotatedKey(tx, params)
    })
  }

  async setRequireMtls(pharmacyId: string, keyId: string, requireMtls: boolean): Promise<PharmacyApiKeySummary | null> {
    const [row] = await this.db
      .update(pharmacyApiKeys)
      .set({ requireMtls })
      .where(and(eq(pharmacyApiKeys.id, keyId), eq(pharmacyApiKeys.pharmacyId, pharmacyId)))
      .returning(SUMMARY_COLUMNS)
    return row ?? null
  }

  async revokeExpiredRotated(keyId: string, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(pharmacyApiKeys)
      .set({ isActive: false, revokedAt: now, revokeReason: 'rotation_grace_period_expired' })
      .where(
        and(
          eq(pharmacyApiKeys.id, keyId),
          isNull(pharmacyApiKeys.revokedAt),
          sql`${pharmacyApiKeys.rotationGraceExpiresAt} IS NOT NULL`,
          lte(pharmacyApiKeys.rotationGraceExpiresAt, now),
        ),
      )
      .returning({ id: pharmacyApiKeys.id })
    return updated.length > 0
  }
}

async function generateKeyMaterial(): Promise<{ readonly secret: string; readonly keyPrefix: string; readonly keyHash: string }> {
  const secret = randomBytes(SECRET_BYTES).toString('hex')
  const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH)
  const keyHash = await argon2.hash(secret)
  return { secret, keyPrefix, keyHash }
}

type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]

async function insertRotatedKey(tx: DrizzleTx, params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKey> {
  const generated = await generateKeyMaterial()
  const [newRow] = await tx
    .insert(pharmacyApiKeys)
    .values({
      pharmacyId: params.pharmacyId,
      chainId: null,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      createdBy: params.createdByAdminId,
      rotatedFromKeyId: params.oldKeyId,
    })
    .returning({ id: pharmacyApiKeys.id, createdAt: pharmacyApiKeys.createdAt })
  if (newRow === undefined) {
    throw new Error('INSERT INTO pharmacy_api_keys (rotate) did not return a row')
  }
  return { id: newRow.id, secret: generated.secret, keyPrefix: generated.keyPrefix, createdAt: newRow.createdAt }
}

export const PHARMACY_API_KEYS_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: PHARMACY_API_KEYS_REPOSITORY,
  useClass: DrizzlePharmacyApiKeysRepository,
} as const
