/**
 * Тестовая фикстура для доменных спеков `delivery` (тот же приём, что
 * `modules/orders/testing/fixtures/fixed-date.fixture.ts`, DTJ-006/DTJ-221) — `testing/` не
 * `domain/`, `no-restricted-globals` на `Date` (eslint.config.mjs `dorutj/domain-purity`,
 * `files: ['**\/domain/**\/*.ts']`) сюда не распространяется. Единственное место в спеках
 * `delivery`, где спека вправе построить конкретный `Date` из ISO-строки.
 */
export function fixedDate(iso: string): Date {
  return new Date(iso)
}
