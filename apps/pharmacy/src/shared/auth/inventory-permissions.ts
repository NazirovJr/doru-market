import type { UserRole } from '@dorutj/contracts'

// 1:1 с @Roles('pharmacy_admin', 'super_admin') inventory-manual-entry/inventory-excel-import.controller.ts — pharmacist читает, не сохраняет.
export const INVENTORY_SAVE_ROLES: readonly UserRole[] = ['pharmacy_admin', 'super_admin']

export function canSaveInventory(role: string | undefined): boolean {
  return role !== undefined && (INVENTORY_SAVE_ROLES as readonly string[]).includes(role)
}
