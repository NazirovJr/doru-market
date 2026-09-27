// `keyPrefix` — первые 8 hex-символов того же секрета (совпадает с `keyId` в X-Pharmacy-API-Key,
// см. PharmacyApiKeyGuard) — редкую коллизию префикса отклонит argon2.verify выше по цепочке.
import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyApiKeys } from '@/db/schema/pharmacy-api-keys.js'
import {
  type CreatedPharmacyApiKey,
  type PharmacyApiKeySummary,
  type PharmacyApiKeysRepository,
  PHARMACY_API_KEYS_REPOSITORY,
} from '@/modules/inventory/application/ports/pharmacy-api-keys.repository.port.js'

const SECRET_BYTES = 32
const KEY_PREFIX_LENGTH = 8

@Injectable()
export class DrizzlePharmacyApiKeysRepository implements PharmacyApiKeysRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(pharmacyId: string): Promise<CreatedPharmacyApiKey> {
    const secret = randomBytes(SECRET_BYTES).toString('hex')
    const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH)
    const keyHash = await argon2.hash(secret)
    const [row] = await this.db
      .insert(pharmacyApiKeys)
      .values({ pharmacyId, chainId: null, keyHash, keyPrefix })
      .returning({ id: pharmacyApiKeys.id, createdAt: pharmacyApiKeys.createdAt })
    if (row === undefined) {
      throw new Error('INSERT INTO pharmacy_api_keys did not return a row')
    }
    return { id: row.id, secret, keyPrefix, createdAt: row.createdAt }
  }

  async listByPharmacy(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]> {
    const rows = await this.db
      .select({
        id: pharmacyApiKeys.id,
        keyPrefix: pharmacyApiKeys.keyPrefix,
        isActive: pharmacyApiKeys.isActive,
        createdAt: pharmacyApiKeys.createdAt,
      })
      .from(pharmacyApiKeys)
      .where(eq(pharmacyApiKeys.pharmacyId, pharmacyId))
    return rows
  }

  async revoke(pharmacyId: string, keyId: string, reason: string): Promise<boolean> {
    const updated = await this.db
      .update(pharmacyApiKeys)
      .set({ isActive: false, note: reason })
      .where(
        and(
          eq(pharmacyApiKeys.id, keyId),
          eq(pharmacyApiKeys.pharmacyId, pharmacyId),
          eq(pharmacyApiKeys.isActive, true),
        ),
      )
      .returning({ id: pharmacyApiKeys.id })
    return updated.length > 0
  }
}

export const PHARMACY_API_KEYS_REPOSITORY_DRIZZLE_PROVIDER = {
  provide: PHARMACY_API_KEYS_REPOSITORY,
  useClass: DrizzlePharmacyApiKeysRepository,
} as const
