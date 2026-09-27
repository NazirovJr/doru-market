// Возвращает PharmacyApiKeySummary — без полных значений секрета.
import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_API_KEYS_REPOSITORY,
  type PharmacyApiKeySummary,
  type PharmacyApiKeysRepository,
} from '../ports/pharmacy-api-keys.repository.port.js'

@Injectable()
export class ListPharmacyApiKeysUseCase {
  constructor(
    @Inject(PHARMACY_API_KEYS_REPOSITORY) private readonly repository: PharmacyApiKeysRepository,
  ) {}

  async execute(pharmacyId: string): Promise<readonly PharmacyApiKeySummary[]> {
    return this.repository.listByPharmacy(pharmacyId)
  }
}
