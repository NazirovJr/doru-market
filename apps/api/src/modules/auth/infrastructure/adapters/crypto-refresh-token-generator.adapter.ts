/**
 * `CryptoRefreshTokenGeneratorAdapter` (EP-01, DTJ-024, SRS-API-025) —
 * production-реализация `RefreshTokenGeneratorPort`.
 *
 * Использует `crypto.randomBytes(32)` (256 бит энтропии) + base64url.
 * Хеш — `sha256(token)` через `node:crypto` (тот же алгоритм, что в
 * `RequestOtpUseCase` для OTP, но без дополнительной соли — refresh
 * сам по себе высокоэнтропийный, дубль пространства 2^256 технически
 * невозможен; UNIQUE-индекс в БД ловит коллизии на всякий случай).
 */
import { createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGeneratorPort,
} from '@/modules/auth/application/ports/refresh-token-generator.port.js'

const REFRESH_TOKEN_BYTES = 32
const SHA256_HEX_LENGTH = 64

@Injectable()
export class CryptoRefreshTokenGeneratorAdapter implements RefreshTokenGeneratorPort {
  generate(): { readonly token: string; readonly hash: string } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
    const hash = createHash('sha256').update(token).digest('hex').slice(0, SHA256_HEX_LENGTH)
    return { token, hash }
  }
}

export { REFRESH_TOKEN_GENERATOR }
