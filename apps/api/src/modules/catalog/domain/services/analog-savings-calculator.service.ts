/**
 * Единственное место формулы экономии аналога (целые дирамы, `null` при `reference <= analog`
 * или отсутствии одной из цен) — переиспользуется `FindAnalogsUseCase` и `CatalogFacadeImpl`.
 * Извлечение цены из офферов — забота вызывающего, у него своё правило выбора (радиус/аптека).
 */
export function computeAnalogSavingsDiram(
  referencePriceDiram: number | null,
  analogPriceDiram: number | null,
): number | null {
  if (referencePriceDiram === null || analogPriceDiram === null) {
    return null
  }
  const diff = referencePriceDiram - analogPriceDiram
  return diff > 0 ? diff : null
}
