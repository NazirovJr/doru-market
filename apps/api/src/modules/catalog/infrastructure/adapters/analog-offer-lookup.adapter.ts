/**
 * `AnalogOfferLookupAdapter` (DTJ-439) — реальная реализация `AnalogOfferLookupPort`
 * (SRS-CAT-038/039, SRS-DOM-157/158), заменяет `NullAnalogOfferLookupAdapter` (DTJ-101,
 * удалён вместе с TODO(DTJ-101→DTJ-160): `InventoryFacade.getOffersForMedicines` теперь
 * существует). Данные (аптека/цена/остаток) принадлежат `inventory` — адаптер только
 * делегирует, вся SQL-логика в `InventoryFacade` (files_owned этого тикета).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-039)
 * @see tickets/ep03-catalog-analogs/DTJ-439.md
 */
import { Inject, Injectable } from '@nestjs/common'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import { InventoryFacade } from '@/modules/inventory/index.js'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupInput,
  type AnalogOfferLookupPort,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'

@Injectable()
export class AnalogOfferLookupAdapter implements AnalogOfferLookupPort {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` (DTJ-001), тот же приём,
  // что остальные адаптеры catalog.
  constructor(@Inject(InventoryFacade) private readonly inventoryFacade: InventoryFacade) {}

  public getOffersForMedicines(
    input: AnalogOfferLookupInput,
  ): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    return this.inventoryFacade.getOffersForMedicines(input)
  }
}

/**
 * DI-привязка (D-27): провайдер для `ANALOG_OFFER_LOOKUP_PORT`.
 * Подключается в `catalog.module.ts` (замена `useClass`, см. её JSDoc).
 */
export const ANALOG_OFFER_LOOKUP_PORT_PROVIDER = {
  provide: ANALOG_OFFER_LOOKUP_PORT,
  useClass: AnalogOfferLookupAdapter,
} as const
