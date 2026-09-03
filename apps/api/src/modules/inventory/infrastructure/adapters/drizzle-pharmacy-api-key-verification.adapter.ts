/**
 * Drizzle-реализация `PharmacyApiKeyVerificationPort` (EP-05, DTJ-156, волна
 * 5 блок C — персистентность модуля inventory). Реализует ВСЕ 10 шагов
 * SRS-API-033 (D-11, `docs/spec/12-api-conventions-auth-tenancy.md` §3.6)
 * против РЕАЛЬНОЙ `pharmacy_api_keys` + Redis (не `Map`, как
 * `InMemoryPharmacyApiKeyVerificationAdapter`):
 *
 *   1. Парсинг `keyId.secret` — делает `PharmacyApiKeyGuard` ДО вызова порта.
 *   2. `SELECT * FROM pharmacy_api_keys WHERE key_prefix = :keyId AND is_active`.
 *   3. `argon2.verify(key_hash, secret)`.
 *   4. mTLS (см. ГЭП ниже).
 *   5. `|now() - timestamp| <= PHARMACY_SIGNATURE_WINDOW_SECONDS`.
 *   6. Redis `SET pharmacy_nonce:{pharmacyId}:{nonce} 1 NX EX <window>` — anti-replay.
 *   7-8. canonical = `METHOD\npath\ntimestamp\nnonce\nhex(sha256(rawBody))`,
 *      `expected = hex(HMAC_SHA256(secret, canonical))`.
 *   9. `timingSafeEqual(expected, signature)`.
 *   10. `{ pharmacyId, chainId }`.
 *
 * **ДВА ЗАДОКУМЕНТИРОВАННЫХ ГЭПА СХЕМЫ (не сочинены молча — см. отчёт
 * сдачи, «Блокеры»/«Найденные чужие проблемы»). `pharmacy_api_keys`
 * (`0015a_inventory_sync_extensions.sql`) НЕ содержит двух колонок, которые
 * требует SRS-API-033/034/SRS-DOM-051:**
 *
 *   - **`revoked_at`** — есть только `is_active BOOLEAN`. Использован как
 *     эквивалент «не отозван» (`is_active = true` ⇔ `revoked_at IS NULL`).
 *     Семантически более грубо (нет времени отзыва для аудита ротации,
 *     SRS-API-034), но не блокирует корректность самой проверки.
 *   - **`require_mtls`** — колонки нет вообще. Шаг 4 не может быть
 *     ключ-специфичным; используется дефолт спеки («`requireMtls` — булев
 *     флаг per-pharmacy, дефолт `false`», SRS-DOM-051) — шаг 4 ВСЕГДА
 *     пропускается (эквивалент `require_mtls=false` для любого ключа).
 *     Ключ с реально включённым mTLS-требованием (если такой заведёт
 *     будущий EP-03 CRUD) не будет принудён на этом уровне до миграции,
 *     добавляющей колонку.
 *
 * **Третий гэп — не схемы, а самой модели.** `PharmacyApiKeyVerificationResult.pharmacyId`
 * обязателен (`string`, не `string | null`), но `pharmacy_api_keys` допускает
 * ключ, скоупнутый на СЕТЬ (`chain_id` заполнен, `pharmacy_id = NULL`,
 * `chk_pharmacy_api_keys_exactly_one_scope`). Контроллер (`InventoryBatchUpdateController`)
 * тоже не резолвит `pharmacy_guid` тела в `pharmacyId` — это уже
 * зафиксированный TODO в `inventory-batch-update.controller.ts`
 * («PHARMACY_NOT_IN_CHAIN_SCOPE... TODO(EP-19, DTJ-157 follow-up)»). Пока
 * контроллер не resolve'ит `pharmacy_guid`, сетевой ключ здесь физически
 * не может вернуть валидный единственный `pharmacyId` — адаптер отклоняет
 * такой ключ `PharmacyApiKeyInvalidError` (не тихо возвращает `chainId` как
 * `pharmacyId` — это увело бы FK `inventory_sync_batch.pharmacy_id` на
 * несуществующую строку `pharmacies`).
 *
 * DI: `@Inject(DRIZZLE_DB)` + `@Inject(REDIS_CLIENT)` явные (esbuild/vitest
 * не эмитит `design:paramtypes`, DTJ-001).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import * as argon2 from 'argon2'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
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
  PharmacyApiKeyInvalidError,
  PharmacyRequestReplayedError,
  PharmacySignatureInvalidError,
  PharmacyTimestampOutOfWindowError,
} from '@dorutj/contracts'

/** D-11 «окно 5 минут» — тот же дефолт, что `InMemoryPharmacyApiKeyVerificationAdapter`. */
const DEFAULT_SIGNATURE_WINDOW_SECONDS = 300
const NONCE_KEY_PREFIX = 'pharmacy_nonce'
const NONCE_MARKER_VALUE = '1'

interface ResolvedKeyRow {
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
    return { pharmacyId: key.pharmacyId, chainId: key.chainId }
  }

  /** Шаги (2)-(4): lookup по `key_prefix`, `argon2.verify`, mTLS (см. ГЭП в JSDoc файла). */
  private async resolveVerifiedKey(input: PharmacyApiKeyVerificationInput): Promise<ResolvedKeyRow> {
    const rows = await this.db
      .select({
        pharmacyId: pharmacyApiKeys.pharmacyId,
        chainId: pharmacyApiKeys.chainId,
        keyHash: pharmacyApiKeys.keyHash,
      })
      .from(pharmacyApiKeys)
      .where(and(eq(pharmacyApiKeys.keyPrefix, input.keyId), eq(pharmacyApiKeys.isActive, true)))
      .limit(1)
    const row = rows[0]
    // (2) не найдено — единая ошибка, не раскрываем, существует ли keyId.
    if (row === undefined) {
      throw new PharmacyApiKeyInvalidError()
    }
    // (2') сетевой ключ без резолва `pharmacy_guid` (ГЭП №3 в JSDoc файла) — ТА ЖЕ
    // ошибка (не отличается от "keyId не существует" для вызывающей стороны).
    if (row.pharmacyId === null) {
      throw new PharmacyApiKeyInvalidError()
    }
    // (3) argon2.verify — `catch`: неверный формат хеша (напр. legacy-строка) тоже "invalid".
    let secretMatches: boolean
    try {
      secretMatches = await argon2.verify(row.keyHash, input.secret)
    } catch {
      secretMatches = false
    }
    if (!secretMatches) {
      throw new PharmacyApiKeyInvalidError()
    }
    // (4) mTLS — `require_mtls` отсутствует в схеме (ГЭП, см. JSDoc файла), дефолт
    // спеки SRS-DOM-051 — `false`, шаг всегда пропускается. `input.mtlsVerifiedHeader`
    // намеренно не читается здесь: если колонка появится, шаг станет
    // `if (row.requireMtls && input.mtlsVerifiedHeader !== 'SUCCESS') throw new MtlsRequiredError()`.
    return { pharmacyId: row.pharmacyId, chainId: row.chainId, keyHash: row.keyHash }
  }

  /** Шаг (5): timestamp-окно. */
  private assertTimestampWithinWindow(input: PharmacyApiKeyVerificationInput): void {
    const nowSec = Math.floor(Date.now() / 1000)
    const ts = Number.parseInt(input.timestamp, 10)
    if (Number.isNaN(ts) || Math.abs(nowSec - ts) > DEFAULT_SIGNATURE_WINDOW_SECONDS) {
      throw new PharmacyTimestampOutOfWindowError()
    }
  }

  /** Шаг (6): РЕАЛЬНЫЙ Redis anti-replay — `SET ... NX EX`, не `Map`. */
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

  /** Шаги (7)-(9): canonical → expected signature (HMAC реальным `secret`) → timing-safe compare. */
  private assertSignatureValid(input: PharmacyApiKeyVerificationInput): void {
    const bodyHash = createHash('sha256').update(input.rawBody).digest('hex')
    const canonical = `${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`
    // Тот же `secret` из заголовка (в памяти этого запроса) — HMAC НЕ восстанавливается
    // из `key_hash` (см. SRS-API-033 шаг 8: хеш служит только для шага 3).
    const expected = createHmac('sha256', input.secret).update(canonical).digest('hex')
    let provided: Buffer
    try {
      provided = Buffer.from(input.signature, 'hex')
    } catch {
      throw new PharmacySignatureInvalidError()
    }
    const expectedBuffer = Buffer.from(expected, 'hex')
    // Сравниваем ДЛИНЫ БУФЕРОВ (байты), не длину hex-строки (см. дефект,
    // зафиксированный в `InMemoryPharmacyApiKeyVerificationAdapter`).
    if (provided.length !== expectedBuffer.length) {
      throw new PharmacySignatureInvalidError()
    }
    if (!timingSafeEqual(provided, expectedBuffer)) {
      throw new PharmacySignatureInvalidError()
    }
  }
}

export const PHARMACY_API_KEY_VERIFICATION_DRIZZLE_PROVIDER = {
  provide: PHARMACY_API_KEY_VERIFICATION,
  useClass: DrizzlePharmacyApiKeyVerificationAdapter,
} as const
