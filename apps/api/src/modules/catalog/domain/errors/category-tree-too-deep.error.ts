import { DomainError } from './domain-error.js'

/** SRS-CAT-002: глубина дерева категорий > `CATEGORY_MAX_DEPTH`. */
export class CategoryTreeTooDeepError extends DomainError {
  public constructor(message: string) {
    super('CATEGORY_TREE_TOO_DEEP', message)
  }
}
