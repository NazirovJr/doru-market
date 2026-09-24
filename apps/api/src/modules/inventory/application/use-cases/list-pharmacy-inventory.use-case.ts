// pharmacyId приходит уже разрешённым из токена — use case не решает о правах, это presentation.
import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type ListByPharmacyCursor,
  type PharmacyInventoryListRow,
  type PharmacyInventoryRepository,
} from '../ports/pharmacy-inventory.repository.port.js'

export interface ListPharmacyInventoryInput {
  readonly pharmacyId: string
  readonly q: string | null
  readonly cursor: ListByPharmacyCursor | null
  readonly limit: number
}

export interface ListPharmacyInventoryResult {
  readonly items: readonly PharmacyInventoryListRow[]
  readonly hasMore: boolean
  readonly nextCursor: ListByPharmacyCursor | null
}

@Injectable()
export class ListPharmacyInventoryUseCase {
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY)
    private readonly repository: PharmacyInventoryRepository,
  ) {}

  async execute(input: ListPharmacyInventoryInput): Promise<ListPharmacyInventoryResult> {
    const { items, hasMore } = await this.repository.listByPharmacy(input)
    const lastItem = items[items.length - 1]
    const nextCursor =
      hasMore && lastItem !== undefined
        ? { tradeName: lastItem.tradeName, id: lastItem.inventoryId }
        : null
    return { items, hasMore, nextCursor }
  }
}
