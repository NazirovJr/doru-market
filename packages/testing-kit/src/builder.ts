/**
 * Единая реализация builder-паттерна для тестовых фикстур (`SRS-NFR-032`): «не сырые
 * JSON-файлы... позволяет точечно переопределять только нужное поле». Конкретные доменные
 * фабрики (`OrderFactory`, `MedicineFactory`, `PharmacyFactory`) создаются каждым владеющим
 * эпиком поверх этой утилиты в СВОЁМ модуле (`tests/fixtures/*.factory.ts`) — здесь только
 * переиспользуемый механизм, избегающий дублирования реализации паттерна (C15).
 */

export interface TestFixtureBuilder<T> {
  build: () => T
}

export interface TestFixtureFactory<T> {
  create: (overrides?: Partial<T>) => TestFixtureBuilder<T>
}

/**
 * Возвращает фабрику фикстур поверх заданных дефолтов. Дефолты и overrides никогда не
 * мутируются (C13) — каждый `create()`/`build()` работает с собственной копией.
 */
export function createBuilder<T>(defaults: T): TestFixtureFactory<T> {
  return {
    create: (overrides: Partial<T> = {}): TestFixtureBuilder<T> => ({
      build: (): T => ({ ...defaults, ...overrides }),
    }),
  }
}
