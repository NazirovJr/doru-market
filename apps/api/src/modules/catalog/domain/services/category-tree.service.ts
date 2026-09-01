/**
 * Доменный сервис `CategoryTreeService` (EP-04, DTJ-094). Чистая функция без I/O:
 * собирает дерево из плоского списка и валидирует его глубину
 * (SRS-CAT-002, `CATEGORY_MAX_DEPTH = 3`).
 *
 * Используется как валидация ПРИ ЧТЕНИИ: use case при `Err` логирует предупреждение
 * и НЕ роняет эндпоинт (деградация без падения — данные уже в БД, вина на админке).
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import type { CategoryNode } from '../medicine.types.js'
import { CategoryTreeTooDeepError } from '../errors/category-tree-too-deep.error.js'

/** SRS-CAT-002: глубже 3 уровней навигация непригодна для мобильного экрана. */
export const CATEGORY_MAX_DEPTH = 3

export interface CategoryRowFlat {
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

export class CategoryTreeService {
  /**
   * Собирает дерево из плоского списка. O(n) по времени и памяти. Сначала строит
   * `Map<id, node>`, затем связывает children к родителям. Корни — узлы с
   * `parentId === null`. Узлы с потерянной связью `parentId` считаются корнями
   * (вина admin-UI, не падаем).
   */
  public buildTree(rows: readonly CategoryRowFlat[]): readonly CategoryNode[] {
    const nodes = new Map<number, CategoryNode>()
    for (const row of rows) {
      nodes.set(row.id, { ...row, children: [] })
    }
    const roots: CategoryNode[] = []
    for (const row of rows) {
      const node = nodes.get(row.id)
      if (node === undefined) {
        continue
      }
      if (row.parentId === null) {
        roots.push(node)
        continue
      }
      const parent = nodes.get(row.parentId)
      if (parent === undefined) {
        roots.push(node)
        continue
      }
      ;(parent.children as CategoryNode[]).push(node)
    }
    return roots
  }

  /**
   * Проверяет, что глубина дерева категорий не превышает `CATEGORY_MAX_DEPTH`. Алгоритм
   * — итеративный DFS с подсчётом уровня (≤200 узлов ожидаемо, SRS-CAT-004, O(n)).
   *
   * Используется как валидация ПРИ ЧТЕНИИ: use case при `Err` логирует предупреждение
   * и НЕ роняет эндпоинт (деградация без падения — данные уже в БД, вина на админке).
   */
  public validateDepth(tree: readonly CategoryNode[]): Result<void, CategoryTreeTooDeepError> {
    if (this.computeMaxDepth(tree) > CATEGORY_MAX_DEPTH) {
      return err(
        new CategoryTreeTooDeepError(
          `category tree depth exceeds ${String(CATEGORY_MAX_DEPTH)} (SRS-CAT-002)`,
        ),
      )
    }
    return ok(undefined)
  }

  /**
   * Возвращает фактическую максимальную глубину дерева. Используется use case'ом
   * при логировании события `category_tree_depth_exceeded`, чтобы оператор видел
   * «насколько глубоко ушли» данные, а не только «превысили порог».
   */
  public getMaxDepth(tree: readonly CategoryNode[]): number {
    return this.computeMaxDepth(tree)
  }

  private computeMaxDepth(tree: readonly CategoryNode[]): number {
    if (tree.length === 0) {
      return 0
    }
    let maxDepth = 0
    const stack: { node: CategoryNode; depth: number }[] = tree.map((node) => ({ node, depth: 1 }))
    while (stack.length > 0) {
      const frame = stack.pop()
      if (!frame) {
        break
      }
      if (frame.depth > maxDepth) {
        maxDepth = frame.depth
      }
      for (const child of frame.node.children) {
        stack.push({ node: child, depth: frame.depth + 1 })
      }
    }
    return maxDepth
  }
}
