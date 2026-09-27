import { Inject, Injectable } from '@nestjs/common'
import { CATALOG_FACADE, type CatalogFacade } from '@/modules/catalog/index.js'
import { parsePeriod } from './get-funnel.use-case.js'
import {
  PRODUCT_EVENTS_REPOSITORY,
  type ProductEventsRepositoryPort,
} from '../ports/product-events-repository.port.js'

const DEFAULT_LIMIT = 10

export interface GetTopAnalogsReportInput {
  readonly tenantId: string
  readonly period: string
  readonly limit?: number
}

export interface TopAnalogReportItem {
  readonly medicineId: string
  readonly medicineName: string
  readonly avgSavingsDiram: bigint
  readonly timesShown: number
  readonly conversionToOrder: number
}

export type GetTopAnalogsReportResult = readonly TopAnalogReportItem[]

@Injectable()
export class GetTopAnalogsReportUseCase {
  public constructor(
    @Inject(PRODUCT_EVENTS_REPOSITORY) private readonly repository: ProductEventsRepositoryPort,
    @Inject(CATALOG_FACADE) private readonly catalogFacade: CatalogFacade,
  ) {}

  public async execute(input: GetTopAnalogsReportInput): Promise<GetTopAnalogsReportResult> {
    const range = parsePeriod(input.period)
    const rows = await this.repository.getTopAnalogsBySavings(input.tenantId, range, input.limit ?? DEFAULT_LIMIT)
    if (rows.length === 0) {
      return []
    }
    const snapshots = await this.catalogFacade.getMedicineSnapshot(rows.map((row) => row.medicineId))
    return rows.map((row) => ({
      medicineId: row.medicineId,
      // Удалённый/несуществующий медикамент — fallback на id, тот же приём, что propose-partial-fulfillment.
      medicineName: snapshots.get(row.medicineId)?.tradeName ?? row.medicineId,
      avgSavingsDiram: row.avgSavingsDiram,
      timesShown: row.timesShown,
      conversionToOrder: row.conversionToOrder,
    }))
  }
}
