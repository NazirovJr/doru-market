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
export * from './errors.js'
export * from './domain-errors.js'
export * from './permissions.js'
export * from './pagination.js'
export * from './envelope.js'
export * from './catalog.js'
export * from './onboarding.js'
export * from './inventory/index.js'
export * from './pharmacies-map.js'
export * from './search.js'
export * from './orders.js'
export * from './payments.js'
export * from './returns.js'
export * from './support.js'
