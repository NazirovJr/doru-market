/**
 * `QueryNormalizationService` (EP-06, DTJ-182, SRS-CAT-024, SRS-CAT-025, SRS-CAT-026,
 * SRS-CAT-078).
 *
 * Персона «Биби Хосият» (research 06 §8.3) вводит запрос латиницей/русской раскладкой
 * без спецсимволов таджикской кириллицы, с опечаткой, либо сканирует штрихкод. Этот
 * сервис — пайплайн нормализации, который `SearchMedicinesUseCase` (application,
 * DTJ-188) обязан прогнать через сырой `text` ДО вызова `SearchProvider.search()`
 * (`SRS-CAT-024`, преамбула §4). Вызывающий код use case появится в DTJ-188 — этот
 * тикет владеет только самим доменным сервисом (DTJ-182 блокирует DTJ-188, use case
 * физически не может существовать раньше своей зависимости).
 *
 * Чистая функция домена: без I/O, без `Date.now()`/`Math.random()`/`process.env`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.6).
 *
 * Пайплайн (`SRS-CAT-024` п.1-4):
 *   а) `trim()` + схлопывание повторных пробелов;
 *   б) детекция штрихкода (8/12/13/14 цифр) — при совпадении дальнейшие шаги
 *      пропускаются, штрихкод не является «опечатанным словом» (см. риск в тикете:
 *      триграммный фолбэк по 13 цифрам дал бы бессмысленные ложные совпадения);
 *   в) эвристика «похоже на транслит»: доля латинских букв среди всех букв строки
 *      строго больше 60% ИЛИ в строке есть буквы, но ни одна не входит в набор
 *      `а-яёӣӯҳқғҷ` (таджикская кириллица целиком — русский алфавит + 6 доп. букв);
 *   г) при срабатывании (в) — `TransliterationNormalizerService.transliterate()`
 *      добавляет ДОПОЛНИТЕЛЬНЫЙ вариант запроса, не заменяя исходный текст
 *      (пользователь мог быть прав с первого раза, SRS-CAT-024 п.3);
 *   д) иначе — только исходный текст, `alternate: null`.
 *
 * Намеренный негативный сценарий (`SRS-CAT-078`, критичный regression): обычная
 * опечатка кириллицей (например «цытрамон») НЕ должна ложно сработать как транслит —
 * доля латиницы там 0%, и в строке ЕСТЬ буквы из таджикского кириллического набора,
 * поэтому обе ветки эвристики (в) остаются ложными. Такие опечатки обрабатываются
 * позже триграммным поиском в `SearchProvider`, не этим сервисом.
 */
import type { TransliterationNormalizerService } from './transliteration-normalizer.service.js'

/** Штрихкод — строка ТОЛЬКО из цифр длиной 8, либо от 12 до 14 (SRS-CAT-024 п.2). */
const BARCODE_PATTERN = /^\d{8}$|^\d{12,14}$/u

/** Порог доли латинских букв, после которого текст считается «похожим на транслит». */
const TRANSLIT_LATIN_RATIO_THRESHOLD = 0.6

const LATIN_LETTER_PATTERN = /[a-z]/u
/** Таджикская кириллица целиком: русский алфавит (а-я, ё) + 6 специфичных букв. */
const TAJIK_CYRILLIC_LETTER_PATTERN = /[а-яёӣӯҳқғҷ]/u
const UNICODE_LETTER_PATTERN = /\p{L}/u

/** Штрихкод: дальнейшие шаги пайплайна пропущены, `alternate` отсутствует как поле. */
export interface NormalizedBarcodeQuery {
  readonly mode: 'barcode'
  readonly value: string
}

/** Обычный текстовый запрос, опционально с транслит-вариантом. */
export interface NormalizedTextQuery {
  readonly mode: 'text'
  readonly primary: string
  readonly alternate: string | null
}

export type NormalizedQuery = NormalizedBarcodeQuery | NormalizedTextQuery

export class QueryNormalizationService {
  constructor(private readonly transliterationNormalizer: TransliterationNormalizerService) {}

  public normalize(rawText: string): NormalizedQuery {
    const collapsed = QueryNormalizationService.collapseWhitespace(rawText)
    if (BARCODE_PATTERN.test(collapsed)) {
      return { mode: 'barcode', value: collapsed }
    }
    return { mode: 'text', primary: collapsed, alternate: this.buildAlternate(collapsed) }
  }

  private buildAlternate(text: string): string | null {
    if (!QueryNormalizationService.looksLikeTranslit(text)) {
      return null
    }
    return this.transliterationNormalizer.transliterate(text)
  }

  private static collapseWhitespace(rawText: string): string {
    return rawText.trim().replace(/\s+/gu, ' ')
  }

  private static looksLikeTranslit(text: string): boolean {
    const letters = QueryNormalizationService.collectLetters(text)
    if (letters.length === 0) {
      return false
    }
    const latinCount = letters.filter((ch) => LATIN_LETTER_PATTERN.test(ch)).length
    const hasTajikCyrillic = letters.some((ch) => TAJIK_CYRILLIC_LETTER_PATTERN.test(ch))
    const latinRatio = latinCount / letters.length
    return latinRatio > TRANSLIT_LATIN_RATIO_THRESHOLD || !hasTajikCyrillic
  }

  private static collectLetters(text: string): string[] {
    // NFC ДО toLowerCase(): некоторые раскладки/шрифты присылают таджикские буквы
    // (ё/ӣ/ӯ) декомпозированными (базовая буква + отдельный диакритический знак).
    // Без композиции знак классифицировался бы как отдельный не-буквенный символ,
    // и эвристика (в) недооценивала бы долю кириллицы — то есть ровно тот случай,
    // который этот тикет обязан корректно распознавать.
    const lower = text.normalize('NFC').toLowerCase()
    return Array.from(lower).filter((ch) => UNICODE_LETTER_PATTERN.test(ch))
  }
}
