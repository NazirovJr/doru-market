/**
 * Ключи TanStack Query для остатков аптеки — общие для `features/inventory-manual` (DTJ-167,
 * инвалидация после точечного ввода) и `features/inventory-bulk` (DTJ-168, массовая сетка читает
 * список под этим же ключом) — вынесено сюда из `inventory-manual`, т.к. горизонтальный импорт
 * между фичами запрещён (`docs/05-DEVELOPER-HANDBOOK.md` §6, «Фронтенд»).
 */
export const INVENTORY_LIST_QUERY_KEY = ['inventory', 'list'] as const
