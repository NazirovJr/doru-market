import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type PharmacyApiKeySummary,
  type PharmacyApiKeysRepository,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class SetPharmacyApiKeyMtlsUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
  ) {}

  async execute(pharmacyId: string, keyId: string, requireMtls: boolean): Promise<PharmacyApiKeySummary | null> {
    return this.repository.setRequireMtls(pharmacyId, keyId, requireMtls)
  }
}
