// Адаптер DTJ-385: межмодульно только через фасад (`modules/catalog/index.ts`), не напрямую в catalog/**.
import { Inject, Injectable } from '@nestjs/common'
import { CATALOG_FACADE, type CatalogFacade } from '@/modules/catalog/index.js'
import {
  ANALOG_SAVINGS_PORT,
  type AnalogSavingsComputeInput,
  type AnalogSavingsPort,
} from '@/modules/analytics/application/ports/analog-savings.port.js'

@Injectable()
export class CatalogAnalogSavingsAdapter implements AnalogSavingsPort {
  constructor(@Inject(CATALOG_FACADE) private readonly catalogFacade: CatalogFacade) {}

  async compute(input: AnalogSavingsComputeInput): Promise<bigint | null> {
    const savingsDiram = await this.catalogFacade.computeAnalogSavingsDiram({
      referenceMedicineId: input.referenceMedicineId,
      analogMedicineId: input.analogMedicineId,
      ...(input.pharmacyId === undefined ? {} : { pharmacyId: input.pharmacyId }),
    })
    return savingsDiram === null ? null : BigInt(savingsDiram)
  }
}

export const ANALOG_SAVINGS_PORT_PROVIDER = { provide: ANALOG_SAVINGS_PORT, useClass: CatalogAnalogSavingsAdapter }
