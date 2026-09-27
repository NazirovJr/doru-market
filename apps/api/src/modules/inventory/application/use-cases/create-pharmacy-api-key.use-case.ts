// Тенант-скоуп проверяет вызывающая сторона (modules/admin) до обращения сюда через InventoryFacade.
import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type CreatedPharmacyApiKey,
  type PharmacyApiKeysRepository,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class CreatePharmacyApiKeyUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
  ) {}

  async execute(pharmacyId: string): Promise<CreatedPharmacyApiKey> {
    return this.repository.create(pharmacyId)
  }
}
