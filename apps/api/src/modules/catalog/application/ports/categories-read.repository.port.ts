/**
 * Порт `CategoriesReadRepository` (DTJ-094, EP-04 / Волна 4) — read-часть для
 * `GET /api/v1/categories`. Возвращает плоский список (контроллер соберёт дерево
 * через `CategoryTreeService.buildTree`, когда тот появится в DTJ-094 полной версии).
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6
 * @see docs/tickets/00-INDEX.md DTJ-094
 */
export const CATEGORIES_READ_REPOSITORY = Symbol.for('@dorutj/catalog/categories-read-repository')

export interface CategoryRecord {
  readonly id: number
  readonly parentId: number | null
  readonly slug: string
  readonly nameTj: string
  readonly nameRu: string
  readonly nameEn: string
  readonly commissionCategory: 'rx' | 'otc' | 'parapharma'
  readonly sortOrder: number
  readonly isActive: boolean
}

export interface CategoriesReadRepository {
  listAll(): Promise<readonly CategoryRecord[]>
}
