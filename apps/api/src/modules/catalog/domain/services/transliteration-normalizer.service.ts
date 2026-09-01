/**
 * `TransliterationNormalizerService` (EP-06, DTJ-182, SRS-CAT-024 п.3, SRS-DB-016).
 *
 * Применяет курированную таблицу транслитерации (`packages/i18n/translit-map.json`)
 * к пользовательскому запросу: латиница/русская раскладка без спецсимволов
 * таджикской кириллицы → таджикская кириллица (`qalb` → `калб`).
 *
 * Таблица НЕ читается этим классом с диска — домен не делает I/O
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6). Загрузка `translit-map.json` —
 * обязанность `infrastructure`-загрузчика при бутстрапе приложения, который
 * передаёт уже распарсенный объект в конструктор один раз (не на каждый вызов —
 * требование производительности из тикета). DTJ-182 владеет только доменным
 * сервисом и содержимым JSON-файла; сам загрузчик подключается вместе с
 * `SearchMedicinesUseCase` в DTJ-188 (там же появится вызывающий код).
 *
 * Алгоритм — жадный longest-match: на каждой позиции строки пробуются ключи
 * таблицы от самого длинного к самому короткому. Порядок важен: слово `qalb`
 * целиком обязано матчиться ПРЕЖДЕ одиночных `q`/`a`/`l`/`b` — иначе результат
 * исказится (посимвольно `q` даёт `қ`, а `qalb` как единое целое обязано дать
 * `калб`, не `қалб`; это ровно тот регрессионный сценарий, что фиксирует
 * `query-normalization.service.spec.ts`). Символы, для которых нет совпадения
 * ни на одной длине, копируются как есть — «символы вне таблицы не трогаются»
 * (тест-план тикета).
 */

/** Результат поиска самого длинного совпадения таблицы, начиная с данной позиции. */
interface TableMatch {
  readonly length: number
  readonly value: string
}

export class TransliterationNormalizerService {
  private readonly table: ReadonlyMap<string, string>
  private readonly maxKeyLength: number

  constructor(translitMap: Readonly<Record<string, string>>) {
    // Map, а не прямой доступ по Record: строка запроса вроде "constructor"
    // резолвилась бы через цепочку прототипов обычного JS-объекта вместо
    // корректного «нет совпадения». У Map такой ловушки нет.
    this.table = new Map(Object.entries(translitMap))
    this.maxKeyLength = TransliterationNormalizerService.computeMaxKeyLength(this.table)
  }

  /**
   * Транслитерирует текст по таблице. Пустая строка на входе → пустая строка
   * на выходе. Регистр входа не важен (таблица курируется в нижнем регистре),
   * результат — всегда нижний регистр.
   */
  public transliterate(text: string): string {
    // NFC на всякий случай (симметрично QueryNormalizationService.collectLetters):
    // латиница a-z декомпозиции не подвержена, но случайная кириллица во входе
    // (например, при смешанной раскладке) не должна давать сюрпризов при поиске
    // по таблице ниже.
    const lower = text.normalize('NFC').toLowerCase()
    let result = ''
    let position = 0
    while (position < lower.length) {
      const match = this.matchLongestKeyAt(lower, position)
      if (match === null) {
        result += lower.charAt(position)
        position += 1
      } else {
        result += match.value
        position += match.length
      }
    }
    return result
  }

  private matchLongestKeyAt(text: string, position: number): TableMatch | null {
    const upperBound = Math.min(this.maxKeyLength, text.length - position)
    for (let length = upperBound; length >= 1; length -= 1) {
      const candidate = text.slice(position, position + length)
      const value = this.table.get(candidate)
      if (value !== undefined) {
        return { length, value }
      }
    }
    return null
  }

  private static computeMaxKeyLength(table: ReadonlyMap<string, string>): number {
    let max = 0
    for (const key of table.keys()) {
      if (key.length > max) {
        max = key.length
      }
    }
    return max
  }
}
