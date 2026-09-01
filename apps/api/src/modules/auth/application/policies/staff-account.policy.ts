/**
 * `StaffAccountPolicy` (EP-01, DTJ-030, SRS-API-035/036) — application-уровневая
 * проверка прав на создание staff-аккаунта. **Первый конкретный пример policy
 * в кодовой базе** — образец для последующих модулей (catalog, orders, ...).
 *
 * Где живёт и почему (SRS-API-036):
 *   - В `application/policies/`, НЕ в `presentation/guards/`. Guard'ы делают
 *     ТОЛЬКО грубую проверку роли (`@Roles(...)` → `RolesGuard`, DTJ-022).
 *     Условные проверки владения (ownership: «это МОЯ аптека/сеть?») — здесь.
 *   - Это даёт два преимущества:
 *     1. Политика тестируется БЕЗ HTTP-слоя (просто функция + таблица истинности,
 *        см. `.spec.ts` — 13 кейсов).
 *     2. Политика может вызываться из use case напрямую (а не из controller'а),
 *        если endpoint имеет несколько операций с разными scope'ами.
 *
 * Контракт `canCreate(actor, target): boolean`:
 *
 *   | actor.role       | target.role       | target.chainId   | result |
 *   |------------------|-------------------|------------------|--------|
 *   | super_admin      | любая             | любая            | ✅ true |
 *   | pharmacy_admin   | pharmacist        | actor.chainId    | ✅ true |
 *   | pharmacy_admin   | courier           | actor.chainId ≠ null | ✅ true |
 *   | pharmacy_admin   | courier           | null (платформенный пул) | ❌ false |
 *   | pharmacy_admin   | pharmacist        | другой chain     | ❌ false |
 *   | pharmacy_admin   | pharmacy_admin    | любая            | ❌ false |
 *   | pharmacy_admin   | support_agent     | любая            | ❌ false |
 *   | pharmacy_admin   | super_admin       | любая            | ❌ false |
 *   | customer, courier, pharmacist, support_agent | любая | — | ❌ false |
 *
 *   ПРИМЕЧАНИЕ: `pharmacy_admin` не может создать `pharmacy_admin` или `super_admin`
 *   (избегаем эскалации привилегий внутри сети). Это сознательное
 *   продуктовое решение, не техническое ограничение.
 *
 *   ПРИМЕЧАНИЕ: `actor.pharmacyId` НЕ проверяется в этой policy — для
 *   `pharmacist`/`courier` (SRS-API-035) достаточно `chainId`-совпадения.
 *   Когда `pharmacyId` станет обязательным для `pharmacist` (EP-03), нужно
 *   добавить проверку `target.pharmacyId ∈ pharmacies_by_actor.chainId`
 *   (отдельный тикет).
 */
import { type UserRole } from '@dorutj/contracts'

export interface StaffAccountPolicyActor {
  readonly role: UserRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export interface StaffAccountPolicyTarget {
  readonly role: UserRole
  readonly chainId: string | null
}

export const StaffAccountPolicy = {
  /**
   * Чистая функция, без side-effects. Возвращает `true`, если `actor` имеет
   * право создать `target` staff-аккаунт. `false` — иначе (НЕ throws —
   * политики возвращают boolean, ошибки формирует вызывающий код с правильным
   * `ErrorCode` и `details`).
   */
  canCreate(actor: StaffAccountPolicyActor, target: StaffAccountPolicyTarget): boolean {
    if (actor.role === 'super_admin') {
      // SRS-API-038: `super_admin` может всё, включая создание другого `super_admin`.
      return true
    }

    if (actor.role !== 'pharmacy_admin') {
      // customer, courier, pharmacist, support_agent — никто из них не заводит staff.
      return false
    }

    // Ниже — только `pharmacy_admin` actor.
    if (target.role === 'pharmacist') {
      // target.chainId должен совпадать с actor.chainId (своя сеть).
      // `actor.chainId === null` означает «аптека без сети» — pharmacist в такой
      // аптеке создать можно, если target.chainId === null.
      return actor.chainId === target.chainId
    }

    if (target.role === 'courier') {
      // Courier собственного флота сети — `chainId !== null` и совпадает с actor.
      // Courier платформенного пула (`chainId === null`) — ТОЛЬКО super_admin
      // (см. actor.role === 'super_admin' ветка выше).
      return target.chainId !== null && actor.chainId === target.chainId
    }

    // pharmacy_admin / super_admin / support_agent / customer — нельзя
    // создавать через pharmacy_admin.
    return false
  },
} as const
