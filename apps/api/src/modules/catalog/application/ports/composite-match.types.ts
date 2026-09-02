/**
 * Типы composite-матчинга (SRS-INV-019..026, реализация в DTJ-097).
 *
 * Вынесены СЮДА из `modules/catalog/index.ts` ради разрыва циклической зависимости:
 * `resolve-medicine-by-composite.use-case.ts` (слой application) импортировал эти типы
 * из барреля модуля, а сам баррель импортирует use case как значение — `arch:check`
 * (`no-circular`) падал на этой паре. Направление зависимости теперь однонаправленное:
 * баррель знает про application, application про баррель — нет.
 *
 * Публичный API модуля не изменился: `index.ts` ре-экспортирует оба типа.
 */

/** Сырые поля позиции прайса, по которым ищется препарат каталога. */
export interface CompositeMatchInput {
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
}

export type MedicineMatchResult =
  | { readonly outcome: 'matched'; readonly medicineId: string; readonly matchedVia: 'barcode' | 'fuzzy' }
  | { readonly outcome: 'ambiguous'; readonly candidateIds: readonly string[] }
  | { readonly outcome: 'no_candidate' }
