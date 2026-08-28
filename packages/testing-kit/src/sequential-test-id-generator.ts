/**
 * Детерминированный тест-дублёр порта `IdGenerator` (`docs/spec/10-domain-model.md` §2.6).
 * `SRS-NFR-030` п.2: unit-тесты получают предсказуемые UUID-подобные строки
 * (`00000000-0000-0000-0000-000000000001`, `...002`, ...) для читаемых ассертов —
 * в integration/E2E используется реальный `Uuidv7IdGenerator` (не подменяется здесь).
 */

/** Шаблон UUID-подобной строки: последний сегмент (12 hex-символов) — счётчик с нулевой набивкой. */
const ID_PREFIX = '00000000-0000-0000-0000-'
const LAST_SEGMENT_LENGTH = 12

export class SequentialTestIdGenerator {
  private counter = 0

  next(): string {
    this.counter += 1
    return `${ID_PREFIX}${String(this.counter).padStart(LAST_SEGMENT_LENGTH, '0')}`
  }

  /** Сбрасывает счётчик — используется для изоляции между тестовыми файлами. */
  reset(): void {
    this.counter = 0
  }
}
