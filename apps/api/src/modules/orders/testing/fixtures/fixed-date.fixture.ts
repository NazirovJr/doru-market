/**
 * Тестовая фикстура для доменных спеков `orders` (тот же приём, что
 * `shared-kernel/testing/fixtures/fixed-date.fixture.ts`, DTJ-006) — `testing/` не `domain/`,
 * `no-restricted-globals` на `Date` сюда не распространяется. Единственное место в спеках
 * `orders`, где спека вправе построить конкретный `Date` из ISO-строки/смещения.
 */
export function fixedDate(iso: string): Date {
  return new Date(iso)
}
