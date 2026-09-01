/**
 * In-memory `CategoriesReadRepository` (DTJ-094, EP-04 / Волна 4) — mock для
 * рантайма до Drizzle-адаптера. Заменяется в последующих тикетах DTJ-092/094.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6
 */
import { Injectable } from '@nestjs/common'
import {
  CATEGORIES_READ_REPOSITORY,
  type CategoriesReadRepository,
  type CategoryRecord,
} from '@/modules/catalog/application/ports/categories-read.repository.port.js'

@Injectable()
export class InMemoryCategoriesReadRepository implements CategoriesReadRepository {
  private readonly rows: readonly CategoryRecord[]

  constructor(initial: readonly CategoryRecord[] = []) {
    this.rows = initial
  }

  listAll(): Promise<readonly CategoryRecord[]> {
    return Promise.resolve(this.rows)
  }
}

/** Re-export, чтобы не дублировать токен. */
export { CATEGORIES_READ_REPOSITORY }
