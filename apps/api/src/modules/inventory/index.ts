// Публичный барабан модуля — пока экспортирует только InventoryFacade, read-only сводку
// остатков для других модулей. Пополняется строками по мере готовности.
export { InventoryFacade, type InventorySummary } from './inventory.facade.js'
