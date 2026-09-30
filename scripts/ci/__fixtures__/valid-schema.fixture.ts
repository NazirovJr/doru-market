// Фикстура для scripts/env-check.spec.ts. Намеренно НЕ импортирует `zod` (корневой node_modules
// его не хостит, см. отчёт о сдаче DTJ-426) — `loadSchemaKeys` требует только объект с полем
// `.shape`, содержимое значений не парсит.
export const envSchema = {
  shape: {
    FOO: {},
    BAR: {},
    BAZ_QUX: {},
  },
}
