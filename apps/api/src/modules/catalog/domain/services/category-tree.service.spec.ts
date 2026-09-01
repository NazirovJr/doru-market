import { describe, expect, it } from 'vitest'
import { CategoryTreeService, CATEGORY_MAX_DEPTH } from './category-tree.service.js'
import { CategoryTreeTooDeepError } from '../errors/category-tree-too-deep.error.js'
import type { CategoryNode } from '../medicine.types.js'

const leaf = (id: number, children: CategoryNode[] = []): CategoryNode => ({
  id,
  parentId: null,
  slug: `slug-${String(id)}`,
  nameTj: `name-${String(id)}-tj`,
  nameRu: `name-${String(id)}-ru`,
  nameEn: `name-${String(id)}-en`,
  commissionCategory: 'otc',
  sortOrder: 0,
  isActive: true,
  children,
})

describe('CategoryTreeService.validateDepth (SRS-CAT-002)', () => {
  const service = new CategoryTreeService()

  it('accepts empty tree', () => {
    expect(service.validateDepth([]).ok).toBe(true)
  })

  it('accepts tree depth 2', () => {
    const tree = [leaf(1, [leaf(2, [leaf(3)])])]
    expect(service.validateDepth(tree).ok).toBe(true)
  })

  it('rejects tree depth greater than CATEGORY_MAX_DEPTH', () => {
    const tree = [leaf(1, [leaf(2, [leaf(3, [leaf(4)])])])]
    const result = service.validateDepth(tree)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(CategoryTreeTooDeepError)
    }
  })

  it('exposes CATEGORY_MAX_DEPTH as 3 (SRS-CAT-002)', () => {
    expect(CATEGORY_MAX_DEPTH).toBe(3)
  })
})
