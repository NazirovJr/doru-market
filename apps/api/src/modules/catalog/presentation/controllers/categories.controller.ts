/**
 * `CategoriesController` (DTJ-094, EP-04 / Волна 4) — `GET /api/v1/categories`
 * возвращает дерево категорий для навигации.
 *
 * Контракт ответа (SRS-CAT-004 + SRS-API-014):
 *   `{ data: CategoryDto[] }` — вложенная структура (не плоский список),
 *   корневые узлы имеют `parentId: null`.
 *
 * Деградация по глубине (SRS-CAT-002): use case логирует warn
 * (`category_tree_depth_exceeded`) и возвращает полное дерево — контроллер НЕ
 * бросает исключение (раньше бросал, см. §11.6 STATE-AND-RESUME-POINT.md).
 *
 * `@Public()`: справочник категорий — публичная навигация (R1-3 поиск работает
 * без авторизации). Резолвинг тенанта всё равно выполняется `TenantResolutionMiddleware`,
 * но маршрут не требует JWT (см. SRS-API-067, `@Public()` semantics).
 */
import { Controller, Get, Inject } from '@nestjs/common'
import { Public } from '@/common/decorators/public.decorator.js'
import { GetCategoryTreeUseCase } from '@/modules/catalog/application/use-cases/get-category-tree.use-case.js'
import {
  toCategoryDtoList,
  type CategoryTreeResponseDto,
} from '@/modules/catalog/presentation/dto/category.dto.js'

@Controller({ path: 'categories', version: '1' })
@Public()
export class CategoriesController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(GetCategoryTreeUseCase) private readonly getCategoryTree: GetCategoryTreeUseCase) {}

  @Get()
  async getTree(): Promise<CategoryTreeResponseDto> {
    const result = await this.getCategoryTree.execute()
    // Use case сейчас всегда возвращает `ok` (`Result<T, never>`): при превышении
    // глубины — лог + полное дерево, без падения (SRS-CAT-002, критерий 3).
    // Контракт Result оставлен ради будущих policy-веток EP-15, тогда здесь
    // добавится map ошибок в `DomainException` (НЕ `throw result.error` — у `never`
    // нет гарантий для фильтра).
    if (!result.ok) {
      // Недостижимо при текущем use case; см. JSDoc выше.
      throw new Error('unexpected category tree failure')
    }
    return { data: toCategoryDtoList(result.value) }
  }
}
