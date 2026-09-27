// Вход ТОЛЬКО из internal-контроллера (RevokeExpiredRotatedKeysJob, apps/worker) — не из admin-CRUD.
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type PharmacyApiKeysRepository,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class RevokeExpiredRotatedKeyUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(keyId: string): Promise<boolean> {
    return this.repository.revokeExpiredRotated(keyId, this.clock.now())
  }
}
