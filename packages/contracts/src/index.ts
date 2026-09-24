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
// DTJ-300 (EP-12) — НЕ реэкспортируется из domain-errors.js (циклический импорт, см. JSDoc файла).
export * from './domain-errors-pharmacy-terminal.js'
// DTJ-160 (EP-05) — та же причина (max-lines), см. JSDoc domain-errors-inventory.ts.
export * from './domain-errors-inventory.js'
// DTJ-282 (EP-14) — тот же приём split по max-lines, НЕ реэкспортируется из domain-errors.js
// (циклический импорт, см. JSDoc domain-errors-support.js).
export * from './domain-errors-support.js'
// Слияние feat/ep-11-returns-flow (EP-11) — та же причина (max-lines), см. JSDoc
// domain-errors-delivery.ts.
export * from './domain-errors-delivery.js'
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
// DTJ-300 (EP-12) — тела запросов терминала фармацевта, отдельный плоский файл (не './orders/'
// директория — избегает коллизии с существующим './orders.js', см. отчёт сдачи тикета).
export * from './orders-pharmacy-terminal.contracts.js'
export * from './delivery/delivery.contracts.js'
export * from './admin/index.js'
export * from './notifications.js'
// DTJ-375 (EP-16) — единый список чувствительных полей (pino-редактор + маскирование audit_log).
export * from './sensitive-fields.js'
export * from './domain-event-envelope.js'
