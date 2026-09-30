// Фикстура для scripts/env-check.spec.ts — модуль существует, но НЕ экспортирует `envSchema`
// (проверяет ветку loadSchemaKeys, отличную от «файла не существует», AC4).
export const somethingElse = 'not a schema'
