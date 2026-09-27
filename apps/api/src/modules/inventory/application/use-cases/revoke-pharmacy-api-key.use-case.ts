// `false` (не найдено/чужая аптека/уже отозван) мапит в NotFoundError вызывающая сторона (modules/admin).
import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type PharmacyApiKeysRepository,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class RevokePharmacyApiKeyUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
  ) {}

  async execute(pharmacyId: string, keyId: string, reason: string): Promise<boolean> {
    return this.repository.revoke(pharmacyId, keyId, reason)
  }
}
