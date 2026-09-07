/** Склеивает CSS-классы, отбрасывая falsy-значения — локальная замена `clsx` без новой зависимости
 * (`AGENTS.md` «не ставь новых зависимостей»), используется всеми компонентами `src/components/**`. */
export type ClassValue = string | false | null | undefined

export function cx(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ')
}
