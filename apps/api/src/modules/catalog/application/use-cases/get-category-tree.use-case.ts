/**
 * `GetCategoryTreeUseCase` (DTJ-094, EP-04 / Волна 4) — `GET /api/v1/categories`.
 * Возвращает дерево категорий (≤3 уровня, SRS-CAT-002) для навигации на главном
 * экране.
 *
 * Контракт чтения (по критериям приёмки DTJ-094):
 *   1. `is_active=false` отфильтровывается на уровне use case ВМЕСТЕ со всеми
 *      потомками — неактивная ветка скрыта целиком, не только сам узел
 *      (SRS-CAT-004 + критерий 2 приёмки).
 *   2. Глубина > `CATEGORY_MAX_DEPTH` логируется как `category_tree_depth_exceeded`
 *      (`pino.warn`), но эндпоинт всё равно возвращает `200` с полным деревом.
 *      Это НЕ падение: данные уже в БД, вина на admin-UI, не на клиенте
 *      (SRS-CAT-002, критерий 3 приёмки).
 *
 * Тенантный скоуп НЕ применяется: дерево категорий — справочник платформы,
 * общий для всех тенантов (мультитенантность — на уровне остатков/заказов,
 * не навигации). См. аналогичный комментарий в `GetMedicineByIdUseCase`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ok, type Result } from '@dorutj/domain-kernel'
import { type CategoryNode } from '@/modules/catalog/domain/medicine.types.js'
import { CategoryTreeService } from '@/modules/catalog/domain/services/category-tree.service.js'
import {
  CATEGORIES_READ_REPOSITORY,
  type CategoriesReadRepository,
  type CategoryRecord,
} from '../ports/categories-read.repository.port.js'

/**
 * Публичный тип use case'а для presentation-слоя (DTO-маппер импортирует ТОЛЬКО
 * этот тип, не доменный `CategoryNode` напрямую — `presentation-goes-through-application`,
 * `.dependency-cruiser.cjs` строка 149). Это алиас того же типа, но он устанавливает
 * «границу» presentation ↔ application: presentation может менять `CategoryNode`
 * без перекомпиляции DTO, пока сигнатура этого алиаса стабильна.
 */
export type CategoryTreeNode = CategoryNode

/** Сейчас use case не имеет failure-ветки кроме деградации, но Result оставлен
 *  для будущих тикетов (например, при появлении policy-ошибок EP-15). */
export type GetCategoryTreeResult = Result<readonly CategoryTreeNode[], never>

@Injectable()
export class GetCategoryTreeUseCase {
  private readonly logger = new Logger(GetCategoryTreeUseCase.name)

  constructor(
    @Inject(CATEGORIES_READ_REPOSITORY)
    private readonly categoriesReadRepository: CategoriesReadRepository,
    // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001.
    @Inject(CategoryTreeService) private readonly categoryTree: CategoryTreeService,
  ) {}

  async execute(): Promise<GetCategoryTreeResult> {
    const allRows = await this.categoriesReadRepository.listAll()
    const activeRows = this.filterActiveSubtree(allRows)
    const tree = this.categoryTree.buildTree(activeRows)
    const validation = this.categoryTree.validateDepth(tree)
    if (!validation.ok) {
      // Деградация без падения (SRS-CAT-002, критерий 3): данные уже в БД,
      // эндпоинт возвращает 200 с полным деревом. Админу — алерт в лог.
      this.logger.warn({
        event: 'category_tree_depth_exceeded',
        maxDepth: this.categoryTree.getMaxDepth(tree),
        categoryMaxDepth: 3,
      }, 'category tree exceeds CATEGORY_MAX_DEPTH=3 (SRS-CAT-002); returning as-is')
    }
    return ok(tree)
  }

  /**
   * Скрывает неактивные узлы ВМЕСТЕ со всеми их потомками.
   *
   * Алгоритм:
   *   1. Собираем множество `id` неактивных узлов.
   *   2. Строим `childrenOf[parentId] → ids[]` для быстрого обхода потомков.
   *   3. BFS вниз от каждого неактивного узла: помечаем всех потомков как
   *      «скрытые».
   *
   * Сложность: O(n) для шага 1-2 + O(|поддерева|) для шага 3. Суммарно O(n),
   * потому что каждый узел посещается ровно один раз (через `hidden.has`).
   * Это безопаснее, чем подъём по `parentId`: если неактивен узел уровня 1,
   * вся его ветка скрывается рекурсивно — соответствует критерию 2 приёмки
   * («эта категория И её потомки отсутствуют»).
   */
  private filterActiveSubtree(rows: readonly CategoryRecord[]): readonly CategoryRecord[] {
    const inactiveIds = this.collectInactiveIds(rows)
    if (inactiveIds.size === 0) {
      return rows
    }
    const childrenOf = this.buildChildrenIndex(rows)
    const hidden = this.markHiddenSubtree(inactiveIds, childrenOf)
    return rows.filter((row) => !hidden.has(row.id))
  }

  /** Шаг 1 алгоритма: множество `id` записей с `isActive=false`. */
  private collectInactiveIds(rows: readonly CategoryRecord[]): Set<number> {
    const inactiveIds = new Set<number>()
    for (const row of rows) {
      if (!row.isActive) {
        inactiveIds.add(row.id)
      }
    }
    return inactiveIds
  }

  /** Шаг 2: индекс `parentId → [childId]` для быстрого обхода потомков. */
  private buildChildrenIndex(rows: readonly CategoryRecord[]): Map<number, number[]> {
    const childrenOf = new Map<number, number[]>()
    for (const row of rows) {
      if (row.parentId === null) {
        continue
      }
      const bucket = childrenOf.get(row.parentId)
      if (bucket === undefined) {
        childrenOf.set(row.parentId, [row.id])
      } else {
        bucket.push(row.id)
      }
    }
    return childrenOf
  }

  /** Шаг 3: BFS вниз от неактивных узлов; возвращает множество скрытых id. */
  private markHiddenSubtree(
    seeds: ReadonlySet<number>,
    childrenOf: ReadonlyMap<number, readonly number[]>,
  ): Set<number> {
    const hidden = new Set<number>()
    const queue: number[] = [...seeds]
    while (queue.length > 0) {
      const id = queue.shift()
      if (id === undefined || hidden.has(id)) {
        continue
      }
      hidden.add(id)
      const children = childrenOf.get(id)
      if (children === undefined) {
        continue
      }
      for (const childId of children) {
        if (!hidden.has(childId)) {
          queue.push(childId)
        }
      }
    }
    return hidden
  }
}
