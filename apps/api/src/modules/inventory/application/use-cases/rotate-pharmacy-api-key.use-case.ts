// Тенант-скоуп и грейс-период (ConfigService) — на стороне admin/facade, не здесь.
import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type CreatedPharmacyApiKey,
  type PharmacyApiKeysRepository,
  type RotatePharmacyApiKeyParams,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class RotatePharmacyApiKeyUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
  ) {}

  async execute(params: RotatePharmacyApiKeyParams): Promise<CreatedPharmacyApiKey | null> {
    return this.repository.rotate(params)
  }
}
