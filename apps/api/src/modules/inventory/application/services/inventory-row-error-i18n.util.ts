/**
 * `errorCode → i18n` (EP-05, DTJ-163/164, SRS-API-015/SRS-INV-044) — построчные коды
 * `inventory_sync_errors` в человекочитаемый локализованный текст.
 *
 * Ключи словаря `inventory.sync_row_error.<errorCode>` УЖЕ СУЩЕСТВУЮТ во всех трёх словарях
 * (`packages/i18n/src/dictionaries/{en,ru,tj}.json`) для ВСЕХ 9 значений
 * `InventorySyncRowErrorCode` — заведены заранее (см. `useT`/DTJ-004), эта функция лишь строит
 * ключ и вызывает существующий `useT(locale).t(...)`, не требует правки словарей.
 */
import { useT, type Locale } from '@dorutj/i18n'
import type { InventorySyncRowErrorCode } from '../ports/inventory-sync-batch.repository.port.js'

export function translateInventoryRowErrorCode(errorCode: InventorySyncRowErrorCode, locale: Locale): string {
  return useT(locale).t(`inventory.sync_row_error.${errorCode}`)
}
