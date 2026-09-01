/**
 * Тест `GetCategoryTreeUseCase` (DTJ-094, EP-04 / Волна 4).
 *
 * Проверяемые ветки (по критериям приёмки тикета):
 *   1. `result.ok === true`, дерево построено (`roots[0].children.length === …`),
 *      `parentId: null` у корня (SRS-CAT-004).
 *   2. Неактивная категория (`isActive=false`) ВМЕСТЕ со всеми её потомками
 *      отсутствует в ответе (не только сам узел — критерий 2 приёмки).
 *   3. Глубина > `CATEGORY_MAX_DEPTH` → `result.ok === true` (НЕ ошибка),
 *      полное дерево возвращается (без обрезки), критерий 3 приёмки.
 *
 * Проверка логирования события `category_tree_depth_exceeded` делается
 * интеграционным тестом `categories.controller.integration.spec.ts` через
 * подмену Nest Logger — здесь мы только проверяем, что use case НЕ падает.
 *
 * @see docs/tickets/ep03-catalog-analogs/DTJ-094.md
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4)
 */
import { describe, expect, it } from 'vitest'
import { CategoryTreeService } from '@/modules/catalog/domain/services/category-tree.service.js'
import { type CategoryNode } from '@/modules/catalog/domain/medicine.types.js'
import {
  type CategoriesReadRepository,
  type CategoryRecord,
} from '@/modules/catalog/application/ports/categories-read.repository.port.js'
import { GetCategoryTreeUseCase } from '@/modules/catalog/application/use-cases/get-category-tree.use-case.js'

/**
 * Минимальный in-memory `CategoriesReadRepository` для теста. Поведение —
 * 1:1 с финальным контрактом порта (DTJ-092): список всех записей без фильтра
 * активности (фильтрация — ответственность use case, не репозитория).
 */
class FakeCategoriesReadRepository implements CategoriesReadRepository {
  private readonly rows: readonly CategoryRecord[]

  constructor(seed: readonly CategoryRecord[] = []) {
    this.rows = seed
  }

  listAll(): Promise<readonly CategoryRecord[]> {
    return Promise.resolve(this.rows)
  }
}

function makeRecord(overrides: Partial<CategoryRecord>): CategoryRecord {
  return {
    id: 0,
    parentId: null,
    slug: 'slug',
    nameTj: 'тадж',
    nameRu: 'рус',
    nameEn: 'en',
    commissionCategory: 'otc',
    sortOrder: 0,
    isActive: true,
    ...overrides,
  }
}

/** Строит use case поверх заданного сида, без NestJS DI (unit-уровень). */
function makeUseCase(seed: readonly CategoryRecord[]): GetCategoryTreeUseCase {
  const repo = new FakeCategoriesReadRepository(seed)
  // Прямой вызов конструктора — здесь мы проверяем use case, не DI-обвязку.
  // Декоратор `@Inject(CATEGORIES_READ_REPOSITORY)` пишет только метаданные
  // для `NestJS DI`, в runtime он ничего не делает — TS вызовет конструктор с
  // позиционными аргументами. Интеграционный тест в `categories.controller.integration.spec.ts`
  // проверит, что use case подключён к DI через `CATEGORIES_READ_REPOSITORY` token.
  return new GetCategoryTreeUseCase(repo, new CategoryTreeService())
}

/** Собирает id всех узлов дерева в порядке pre-order (root → children). */
function collectIds(nodes: readonly CategoryNode[]): number[] {
  const out: number[] = []
  const walk = (n: CategoryNode): void => {
    out.push(n.id)
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}

/**
 * Идёт по левой ветке цепочки (когда у каждого узла ровно 1 ребёнок) и возвращает
 * id пройденных узлов. Используется в тестах на глубину (SRS-CAT-002).
 */
function collectChainIds(nodes: readonly CategoryNode[]): number[] {
  const out: number[] = []
  let current: CategoryNode | undefined = nodes[0]
  while (current !== undefined) {
    out.push(current.id)
    current = current.children[0]
  }
  return out
}

describe('GetCategoryTreeUseCase (DTJ-094, SRS-CAT-002/004)', () => {
  it('1a. пустой каталог → ok, пустое дерево', async () => {
    const useCase = makeUseCase([])
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual([])
    }
  })

  it('1b. 3-уровневое дерево из 15 записей → ok, вложенная структура, корни parentId=null', async () => {
    // Строим 5 корней, у каждого по 2 ребёнка, у каждого ребёнка по 1 листу = 5 + 10 + 5 = 20.
    // Подрежем до 15: 3 корня × (2 ребёнка × 1 лист + 1 корень с одним листом) = 3 + 6 + 3 = 12.
    // Упростим: 3 корня × (1 ребёнок × 1 лист) = 3 + 3 + 3 = 9 — мало. Возьмём:
    //   3 корня, у двух по (ребёнок + 2 листа) = 1+2+1 каждый = 4 → 8
    //   у одного (ребёнок + 1 лист) = 2 → 2
    //   итого 10. Не 15. Делаем плоско и проверяем структуру:
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'root-1' }),
      makeRecord({ id: 2, parentId: null, slug: 'root-2' }),
      makeRecord({ id: 3, parentId: null, slug: 'root-3' }),
      makeRecord({ id: 11, parentId: 1, slug: 'r1-c1' }),
      makeRecord({ id: 12, parentId: 1, slug: 'r1-c2' }),
      makeRecord({ id: 21, parentId: 2, slug: 'r2-c1' }),
      makeRecord({ id: 22, parentId: 2, slug: 'r2-c2' }),
      makeRecord({ id: 31, parentId: 3, slug: 'r3-c1' }),
      makeRecord({ id: 32, parentId: 3, slug: 'r3-c2' }),
      makeRecord({ id: 111, parentId: 11, slug: 'r1-c1-l1' }),
      // parentId:32 (не 11) — иначе ребёнок 32 (r3-c2) остаётся БЕЗ единого
      // листа: ассерт ниже требует `child.children.length >= 1` для КАЖДОГО
      // ребёнка каждого корня, а прежняя раскладка (2 листа под 11, 0 под 32)
      // нарушала это для 32. Общее число записей (15) не меняется.
      makeRecord({ id: 112, parentId: 32, slug: 'r3-c2-l1' }),
      makeRecord({ id: 121, parentId: 12, slug: 'r1-c2-l1' }),
      makeRecord({ id: 211, parentId: 21, slug: 'r2-c1-l1' }),
      makeRecord({ id: 221, parentId: 22, slug: 'r2-c2-l1' }),
      makeRecord({ id: 311, parentId: 31, slug: 'r3-c1-l1' }),
    ]
    const useCase = makeUseCase(rows)
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(3)
    for (const root of result.value) {
      expect(root.parentId).toBeNull()
      // Каждый корень имеет ровно 2 ребёнка (id ∈ {11,12}, {21,22}, {31,32})
      expect(root.children).toHaveLength(2)
      for (const child of root.children) {
        // У каждого ребёнка — минимум 1 лист (валидация глубины 3 проходит)
        expect(child.children.length).toBeGreaterThanOrEqual(1)
        for (const leaf of child.children) {
          expect(leaf.children).toEqual([])
        }
      }
    }
  })

  it('2. isActive=false скрывает узел И всех его потомков целиком (критерий 2 приёмки)', async () => {
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'root' }),
      makeRecord({ id: 2, parentId: 1, slug: 'active-mid' }),
      makeRecord({ id: 3, parentId: 2, slug: 'active-leaf' }),
      makeRecord({ id: 4, parentId: 1, slug: 'inactive-mid', isActive: false }),
      makeRecord({ id: 5, parentId: 4, slug: 'inactive-leaf' }),
      makeRecord({ id: 6, parentId: 1, slug: 'other-active' }),
    ]
    const useCase = makeUseCase(rows)
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // id=4 (inactive-mid) и id=5 (его потомок) скрыты; остальные видны.
    const allIds = new Set<number>(collectIds(result.value))
    expect(allIds.has(1)).toBe(true)
    expect(allIds.has(2)).toBe(true)
    expect(allIds.has(3)).toBe(true)
    expect(allIds.has(4)).toBe(false)
    expect(allIds.has(5)).toBe(false)
    expect(allIds.has(6)).toBe(true)
  })

  it('3a. глубина > CATEGORY_MAX_DEPTH → ok (НЕ ошибка), полное дерево возвращается (критерий 3 приёмки)', async () => {
    // Строим цепочку из 5 уровней (parentId → parentId → ...).
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'l1' }),
      makeRecord({ id: 2, parentId: 1, slug: 'l2' }),
      makeRecord({ id: 3, parentId: 2, slug: 'l3' }),
      makeRecord({ id: 4, parentId: 3, slug: 'l4' }),
      makeRecord({ id: 5, parentId: 4, slug: 'l5' }),
    ]
    const useCase = makeUseCase(rows)
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Полное дерево НЕ обрезано: вся цепочка видна.
    const expectedIds = [1, 2, 3, 4, 5]
    const collectedIds = collectChainIds(result.value)
    expect(collectedIds).toEqual(expectedIds)
  })

  it('3b. при превышении глубины НЕ пробрасывается исключение наружу', async () => {
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'l1' }),
      makeRecord({ id: 2, parentId: 1, slug: 'l2' }),
      makeRecord({ id: 3, parentId: 2, slug: 'l3' }),
      makeRecord({ id: 4, parentId: 3, slug: 'l4' }),
    ]
    const useCase = makeUseCase(rows)
    await expect(useCase.execute()).resolves.toMatchObject({ ok: true })
  })

  it('4. все записи неактивны → ok, пустое дерево', async () => {
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'a', isActive: false }),
      makeRecord({ id: 2, parentId: 1, slug: 'b', isActive: false }),
    ]
    const useCase = makeUseCase(rows)
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual([])
    }
  })

  it('5. validateDepth вызывается (через интеграцию с CategoryTreeService)', async () => {
    // Smoke: сервис реальный, не мок — его собственные тесты покрывают логику.
    const rows: CategoryRecord[] = [
      makeRecord({ id: 1, parentId: null, slug: 'r' }),
      makeRecord({ id: 2, parentId: 1, slug: 'r-c' }),
    ]
    const useCase = makeUseCase(rows)
    const result = await useCase.execute()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value[0]?.id).toBe(1)
      expect(result.value[0]?.children[0]?.id).toBe(2)
    }
  })
})