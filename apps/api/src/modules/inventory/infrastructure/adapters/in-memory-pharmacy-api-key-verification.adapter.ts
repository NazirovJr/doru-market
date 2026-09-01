/**
 * InMemory-реализация `PharmacyApiKeyVerificationPort` (EP-05, DTJ-156, R1-бутстрап).
 *
 * Реализует ВСЕ 10 шагов SRS-API-033 (D-11):
 * 1. парсинг `keyId.secret`
 * 2. lookup по `keyId` (имитация таблицы `pharmacy_api_keys`)
 * 3. сравнение `secret` (мок; Drizzle-адаптер заменит на `argon2.verify`)
 * 4. mTLS-проверка
 * 5. timestamp-окно
 * 6. Redis nonce-replay
 * 7. canonical = `METHOD\npath\ntimestamp\nnonce\nhex(sha256(rawBody))`
 * 8. expected = hex(HMAC-SHA256(key=secret, data=canonical))
 * 9. timing-safe сравнение подписи
 * 10. возврат `{ pharmacyId, chainId }`
 *
 * **ВНИМАНИЕ:** plain-сравнение `secret` — ТОЛЬКО для R1-bутстрапа.
 * Drizzle-реализация (TODO DTJ-154 follow-up) ОБЯЗАНА использовать
 * `argon2.verify(key_hash, secret)`. Это требование безопасности,
 * не опциональная деталь.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  PHARMACY_API_KEY_VERIFICATION,
  type PharmacyApiKeyVerificationInput,
  type PharmacyApiKeyVerificationPort,
  type PharmacyApiKeyVerificationResult,
} from '../../application/ports/pharmacy-api-key-verification.port.js'
import {
  MtlsRequiredError,
  PharmacyApiKeyInvalidError,
  PharmacyRequestReplayedError,
  PharmacySignatureInvalidError,
  PharmacyTimestampOutOfWindowError,
} from '@dorutj/contracts'

/** Состояние тестовой БД. */
interface MockApiKey {
  readonly keyId: string
  readonly secretPlain: string // только для R1-бутстрапа
  readonly pharmacyId: string
  readonly chainId: string | null
  readonly requireMtls: boolean
  readonly revokedAt: Date | null
}

const DEFAULT_SIGNATURE_WINDOW_SECONDS = 300

@Injectable()
export class InMemoryPharmacyApiKeyVerificationAdapter
  implements PharmacyApiKeyVerificationPort
{
  /** Ключи. В R1-бутстрапе заполняется через `seed(...)`. */
  public readonly keys = new Map<string, MockApiKey>()

  /** Использованные nonce'ы: `${pharmacyId}::${nonce}` → момент. */
  private readonly usedNonces = new Map<string, Date>()

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis Redis client
    @Inject(REDIS_CLIENT) _redis: any,
  ) {
    // In-memory адаптер не использует Redis — оставлено для совместимости с DI
    // будущих адаптеров (R2: реальная Redis-реализация nonce-store).
    void _redis
  }

  async verify(
    input: PharmacyApiKeyVerificationInput,
  ): Promise<PharmacyApiKeyVerificationResult> {
    // (2) lookup по `keyId`
    const key = this.keys.get(input.keyId)
    if (key === undefined || key.revokedAt !== null) {
      throw new PharmacyApiKeyInvalidError()
    }

    // (3) сравнение `secret` (мок; Drizzle → argon2)
    if (key.secretPlain !== input.secret) {
      throw new PharmacyApiKeyInvalidError()
    }

    // (4) mTLS
    if (key.requireMtls && input.mtlsVerifiedHeader !== 'SUCCESS') {
      throw new MtlsRequiredError()
    }

    // (5) timestamp-окно
    const nowSec = Math.floor(Date.now() / 1000)
    const ts = Number.parseInt(input.timestamp, 10)
    if (Number.isNaN(ts) || Math.abs(nowSec - ts) > DEFAULT_SIGNATURE_WINDOW_SECONDS) {
      throw new PharmacyTimestampOutOfWindowError()
    }

    // (6) Redis nonce-replay
    const nonceKey = `${key.pharmacyId}::${input.nonce}`
    const already = this.usedNonces.get(nonceKey)
    if (already !== undefined) {
      throw new PharmacyRequestReplayedError()
    }
    this.usedNonces.set(nonceKey, new Date())
    // TODO(EP-19, DTJ-156 Drizzle): реальный `SET pharmacy_nonce:... 1 NX EX 300`.

    // (7) canonical
    const bodyHash = createHash('sha256').update(input.rawBody).digest('hex')
    const canonical = `${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${bodyHash}`

    // (8) expected signature
    const expected = createHmac('sha256', key.secretPlain).update(canonical).digest('hex')

    // (9) timing-safe compare
    let provided: Buffer
    try {
      provided = Buffer.from(input.signature, 'hex')
    } catch {
      throw new PharmacySignatureInvalidError()
    }
    const expectedBuffer = Buffer.from(expected, 'hex')
    // Сравниваем ДЛИНЫ БУФЕРОВ (байты), не `expected.length` (символы hex-строки,
    // РОВНО в 2 раза больше байтовой длины — сравнение всегда было false, ЛЮБАЯ
    // корректная подпись отклонялась как `PharmacySignatureInvalidError`).
    if (provided.length !== expectedBuffer.length) {
      throw new PharmacySignatureInvalidError()
    }
    if (!timingSafeEqual(provided, expectedBuffer)) {
      throw new PharmacySignatureInvalidError()
    }

    // (10) success
    return { pharmacyId: key.pharmacyId, chainId: key.chainId }
  }

  /** Хелпер для тестов / R1-bутстрапа. */
  seed(key: MockApiKey): void {
    this.keys.set(key.keyId, key)
  }
}

export const PHARMACY_API_KEY_VERIFICATION_INMEMORY_PROVIDER = {
  provide: PHARMACY_API_KEY_VERIFICATION,
  useClass: InMemoryPharmacyApiKeyVerificationAdapter,
} as const
