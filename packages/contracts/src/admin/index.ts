// Барабан подпапки `admin/` (D-27, DTJ-350, EP-15).
//
// Пустая заглушка — намеренно. Каждый следующий тикет эпика (DTJ-351..367), которому
// понадобится DTO/Zod-схема для `apps/admin`/`modules/admin`, заводит СВОЙ файл
// `packages/contracts/src/admin/<feature>.ts` и добавляет РОВНО одну строку экспорта сюда
// (тот же приём, что `packages/contracts/src/inventory/index.ts` для контекста `inventory`).
export {}
