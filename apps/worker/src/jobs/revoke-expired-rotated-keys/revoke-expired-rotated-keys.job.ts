import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  API_INTERNAL_URL_TOKEN,
  INTERNAL_API_KEY_TOKEN,
  requestRevokeExpiredRotatedKey,
  type RevokeExpiredRotatedKeyDeps,
} from './revoke-expired-rotated-key.client.js'

export const EXPIRED_ROTATED_KEY_SCANNER = Symbol.for('@dorutj/worker/expired-rotated-key-scanner')

export interface ExpiredRotatedKey {
  readonly keyId: string
}

export interface ExpiredRotatedKeyScannerPort {
  findExpiredRotatedKeys(now: Date): Promise<readonly ExpiredRotatedKey[]>
}

export interface RevokeExpiredRotatedKeysResult {
  readonly scanned: number
  readonly revoked: number
  readonly skipped: number
}

type KeyOutcome = 'revoked' | 'skipped'

@Injectable()
export class RevokeExpiredRotatedKeysJob {
  private readonly logger = new Logger(RevokeExpiredRotatedKeysJob.name)

  constructor(
    @Inject(EXPIRED_ROTATED_KEY_SCANNER) private readonly scanner: ExpiredRotatedKeyScannerPort,
    @Inject(API_INTERNAL_URL_TOKEN) private readonly apiInternalUrl: string,
    @Inject(INTERNAL_API_KEY_TOKEN) private readonly internalApiKey: string | undefined,
  ) {}

  async runOnce(now: Date = new Date()): Promise<RevokeExpiredRotatedKeysResult> {
    const expired = await this.scanner.findExpiredRotatedKeys(now)
    const deps: RevokeExpiredRotatedKeyDeps = { apiInternalUrl: this.apiInternalUrl, internalApiKey: this.internalApiKey }
    const settled = await Promise.allSettled(expired.map((key) => this.revokeOne(key, deps)))
    this.logSettledErrors(settled, expired)
    const result = this.summarize(expired.length, settled)
    this.logger.log(
      `revoke-expired-rotated-keys: тик выполнен — просканировано ${String(result.scanned)}, ` +
        `отозвано ${String(result.revoked)}, пропущено ${String(result.skipped)}`,
    )
    return result
  }

  private async revokeOne(key: ExpiredRotatedKey, deps: RevokeExpiredRotatedKeyDeps): Promise<KeyOutcome> {
    const result = await requestRevokeExpiredRotatedKey(deps, key.keyId)
    return result.revoked ? 'revoked' : 'skipped'
  }

  private summarize(scanned: number, settled: readonly PromiseSettledResult<KeyOutcome>[]): RevokeExpiredRotatedKeysResult {
    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<KeyOutcome> => r.status === 'fulfilled')
    const revoked = fulfilled.filter((r) => r.value === 'revoked').length
    const skipped = fulfilled.filter((r) => r.value === 'skipped').length
    return { scanned, revoked, skipped }
  }

  private logSettledErrors(settled: readonly PromiseSettledResult<KeyOutcome>[], keys: readonly ExpiredRotatedKey[]): void {
    const errors = settled.flatMap((result, idx) => {
      if (result.status !== 'rejected') return []
      const keyId = keys[idx]?.keyId ?? '?'
      return [`${keyId}: ${String(result.reason)}`]
    })
    if (errors.length > 0) {
      this.logger.error(`revoke-expired-rotated-keys: ${String(errors.length)} ошибок обработки — ${errors.join('; ')}`)
    }
  }
}
