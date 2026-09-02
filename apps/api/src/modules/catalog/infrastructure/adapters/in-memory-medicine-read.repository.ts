/**
 * In-memory `MedicineReadRepository` (DTJ-092, read-часть для EP-04 / Волна 4).
 *
 * Это MOCK-реализация на время EP-04 (R1). Полноценный Drizzle-адаптер появится
 * в последующих тикетах DTJ-092/096/097 (Волна 4 и далее). Mock семантически
 * ТОЧНО воспроизводит финальный контракт, чтобы use case можно было покрыть
 * integration-тестами без БД.
 *
 * Поведение:
 *   - На старте конструктора принимает массив `Medicine` (для теста/seed).
 *   - `findById(id)` — простой lookup в `Map`; для записей с `controlCategory`
 *     в `{psychotropic, narcotic}` возвращает `null` (SRS-CAT-006).
 *   - `listByCategoryId` / `listPublished` — фильтр + слайс. `isPublished = false`
 *     и `psychotropic`/`narcotic` исключаются (см. инвариант `Medicine.canOrderRemotely()`).
 *   - Это singleton (NestJS провайдер), но `Map` копируется в конструкторе,
 *     чтобы тесты могли иметь изолированные экземпляры.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4)
 * @see docs/tickets/00-INDEX.md DTJ-092
 */
import { Injectable, Optional } from '@nestjs/common'
import { CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE } from '@/modules/catalog/domain/medicine.enums.js'
import { type Medicine } from '@/modules/catalog/domain/medicine.entity.js'
import {
  MEDICINE_READ_REPOSITORY,
  type ListMedicinesParams,
  type MedicineReadRepository,
} from '@/modules/catalog/application/ports/medicine-read.repository.port.js'

@Injectable()
export class InMemoryMedicineReadRepository implements MedicineReadRepository {
  private readonly byId: Map<string, Medicine>

  // @Optional(): tsc (боевая сборка) эмитит `design:paramtypes` и Nest видит тип `Array`,
  // для которого провайдера нет — без этого декоратора приложение НЕ стартует
  // («can't resolve dependencies of the InMemoryMedicineReadRepository (index 0 ... Array)»).
  // Под vitest (esbuild) метаданных нет, класс создаётся без аргументов и дефект не виден —
  // именно поэтому расхождение ловится только запуском собранного `dist/main.js`.
  constructor(@Optional() initial: readonly Medicine[] = []) {
    this.byId = new Map()
    for (const medicine of initial) {
      this.byId.set(medicine.getId(), medicine)
    }
  }

  findById(id: string): Promise<Medicine | null> {
    const found = this.byId.get(id)
    if (found === undefined) {
      return Promise.resolve(null)
    }
    if (CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(found.getControlCategory())) {
      // SRS-CAT-006: существование запрещённой записи не подтверждается постороннему.
      return Promise.resolve(null)
    }
    return Promise.resolve(found)
  }

  listByCategoryId(categoryId: number, params: ListMedicinesParams): Promise<readonly Medicine[]> {
    const filtered = this.filterForListing(this.byId.values(), (m) => m.getCategoryId() === categoryId)
    return Promise.resolve(this.paginate(filtered, params))
  }

  listPublished(params: ListMedicinesParams): Promise<readonly Medicine[]> {
    const filtered = this.filterForListing(this.byId.values(), () => true)
    return Promise.resolve(this.paginate(filtered, params))
  }

  private filterForListing(
    source: IterableIterator<Medicine>,
    extraFilter: (m: Medicine) => boolean,
  ): readonly Medicine[] {
    const result: Medicine[] = []
    for (const m of source) {
      if (!m.canOrderRemotely()) {
        continue
      }
      if (CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(m.getControlCategory())) {
        continue
      }
      if (!extraFilter(m)) {
        continue
      }
      result.push(m)
    }
    return result
  }

  private paginate(items: readonly Medicine[], params: ListMedicinesParams): readonly Medicine[] {
    return items.slice(params.offset, params.offset + params.limit)
  }
}

/** DI-токен для NestJS-провайдера. */
export { MEDICINE_READ_REPOSITORY }
