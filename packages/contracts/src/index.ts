// Барабанный экспорт пакета (D-27).
//
// Правило пополнения (tickets/00-EPICS.md §«Пересекающееся владение», DTJ-005):
// - `errors.ts`, `domain-errors.ts`, `permissions.ts`, `pagination.ts`, `envelope.ts` — ОБЩИЕ
//   файлы каталога (коды ошибок, permission-строки RBAC, формат пагинации/ответа), владелец —
//   EP-01 НАВСЕГДА. Другие эпики НЕ заводят свои файлы ошибок/прав — новые значения добавляются
//   В КОНЕЦ существующих enum/const этих же файлов (конфликт слияния решается rebase).
// - Каждый последующий эпик добавляет СВОЙ файл в подпапку (`src/inventory/`, `src/analogs/`,
//   `src/payments/`, …) для DTO/Zod-схем своего модуля и ОДНУ строку экспорта здесь — этим
//   файлом владеет соответствующий эпик, не EP-01.
export * from './errors'
export * from './domain-errors'
export * from './permissions'
export * from './pagination'
export * from './envelope'
export * from './catalog'
export * from './onboarding'
export * from './inventory/index.js'
export * from './pharmacies-map'
export * from './search'
