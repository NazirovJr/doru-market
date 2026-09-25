/**
 * `computeAnalogSavingsDiram` (DTJ-385) — ЕДИНСТВЕННОЕ место формулы экономии аналога:
 * целые дирамы (D-06/SRS-DOM-159), без округления, `null` при отсутствии одной из цен
 * или `referencePriceDiram <= analogPriceDiram`. До этого тикета формула дублировалась
 * в `FindAnalogsUseCase` (список аналогов) и в `CatalogFacadeImpl` (серверная экономия
 * аналитики, DTJ-385) — обе точки теперь зовут эту функцию.
 *
 * Чистая функция: без I/O, без `Date.now()`/`Math.random()`/`process.env` (§2.6).
 * Извлечение самой дешёвой цены из офферов (с фильтром по аптеке или без) — забота
 * вызывающего слоя, не этой функции: у `FindAnalogsUseCase` и фасада разные правила
 * выбора цены (весь радиус vs конкретная аптека).
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
