/**
 * `CategoryDto` (DTJ-094, EP-04, R1) — JSON-контракт дерева категорий
 * `GET /api/v1/categories` по SRS-CAT-004.
 *
 * Формат ответа (SRS-CAT-004):
 *   `{ id, parentId, slug, name: {tj, ru, en}, sortOrder, childrenCount }`
 *
 * Конвертация `CategoryTreeNode` (use case) → DTO делается здесь, в
 * presentation-слое (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.2: маппер
 * DTO↔domain живёт в presentation). Presentation НЕ импортирует `domain/`
 * напрямую — тип `CategoryTreeNode` реэкспортирован use case'ом
 * (`application/use-cases/get-category-tree.use-case.ts`) — это легальный
 * проход через application-слой, требуемый правилом
 * `presentation-goes-through-application` (`.dependency-cruiser.cjs`).
 *
 * **`childrenCount`** — вычисляемое поле: кол-во ПРЯМЫХ потомков, не рекурсивное.
 * Не хранится в БД — считается в маппере по `node.children.length`. O(1) на узел.
 *
 * **`isActive` НЕ отдаётся клиенту** — он уже отфильтрован на уровне use case
 * (`GetCategoryTreeUseCase.filterActiveSubtree`), а на UI скрывать нечего.
 */
import type { CategoryTreeNode } from '@/modules/catalog/application/use-cases/get-category-tree.use-case.js'

/** Узел дерева категорий в HTTP-ответе (`{ data: CategoryDto[] }`). */
export interface CategoryDto {
  readonly id: number
  readonly parentId: number | null
  readonly slug: string
  readonly name: { readonly tj: string; readonly ru: string; readonly en: string }
  readonly sortOrder: number
  readonly childrenCount: number
  readonly children: readonly CategoryDto[]
}

/** Корень успешного ответа `GET /api/v1/categories` (SRS-API-014). */
export interface CategoryTreeResponseDto {
  readonly data: readonly CategoryDto[]
}

/**
 * Рекурсивная конвертация `CategoryTreeNode` (use case) → `CategoryDto` (HTTP).
 * Идёмпотентна, вычислительная стоимость O(n).
 */
export function toCategoryDto(node: CategoryTreeNode): CategoryDto {
  return {
    id: node.id,
    parentId: node.parentId,
    slug: node.slug,
    name: {
      tj: node.nameTj,
      ru: node.nameRu,
      en: node.nameEn,
    },
    sortOrder: node.sortOrder,
    childrenCount: node.children.length,
    children: node.children.map(toCategoryDto),
  }
}

/** Маппинг массива корней дерева → DTO-массив. */
export function toCategoryDtoList(nodes: readonly CategoryTreeNode[]): readonly CategoryDto[] {
  return nodes.map(toCategoryDto)
}