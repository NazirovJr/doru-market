/**
 * Загрузчик `packages/i18n/translit-map.json` (EP-06, DTJ-188).
 *
 * `TransliterationNormalizerService`/`QueryNormalizationService` (DTJ-182, `domain`) — чистые
 * функции без I/O: JSDoc обоих файлов прямо назначает чтение файла «`infrastructure`-загрузчику
 * при бутстрапе», который «подключается вместе с `SearchMedicinesUseCase` в DTJ-188» — это тот
 * загрузчик, регистрируется факторкой в `catalog.module.ts`.
 *
 * **Почему `fs.readFileSync`, а не `import ... from '....json'`.**
 *   1. `no-restricted-imports` (`eslint.config.mjs`, C16) запрещает относительные импорты
 *      на 2+ уровня вверх — путь до `packages/i18n/` отсюда на порядок глубже.
 *   2. `packages/i18n/package.json` публикует в `exports` ТОЛЬКО `"."` (`./dist/index.js`) —
 *      `@dorutj/i18n/translit-map.json` не резолвится ни рантаймом (Node ESM `exports`-карта
 *      это отдельная разрешённая точка входа), ни без правки чужого `package.json`/барреля
 *      `packages/i18n/src/index.ts` (вне `files_owned` этого тикета, Ж7).
 * Прямое чтение файла обходит оба ограничения и держит единственным источником данных сам
 * JSON-файл (Ж12 — не копия).
 *
 * **Путь стабилен и для `src` (vitest/ts-node), и для собранного `dist`.** `tsconfig.build.json`
 * (`rootDir: src`, `outDir: dist`) зеркалит структуру каталогов 1:1 — глубина этого файла
 * относительно корня репозитория одинакова что под `apps/api/src/...`, что под
 * `apps/api/dist/...`, поэтому `import.meta.url` даёт идентичный относительный путь наверх в
 * обоих случаях (проверено вручную через `path.relative`, см. отчёт сдачи DTJ-188).
 *
 * Читается ОДИН раз за вызов фабрики (DI `useFactory`, `catalog.module.ts` резолвит singleton) —
 * не на каждый поисковый запрос (требование производительности DTJ-182 «Что сделать» п.2).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 7 уровней вверх: loaders → infrastructure → catalog → modules → src → api → apps → (корень). */
const TRANSLIT_MAP_RELATIVE_PATH = '../../../../../../../packages/i18n/translit-map.json'

interface TranslitMapFile {
  readonly pairs?: Record<string, string>
}

/**
 * Читает и валидирует `translit-map.json`. Бросает при отсутствии файла/поля `pairs` —
 * fail-fast при старте DI-графа (Ж1: тихая деградация до пустой таблицы транслитерации
 * незаметно превратила бы `TC-CAT-007` в вечно проходящий негативный кейс, а не в реальную
 * защиту от регресса).
 */
export function loadTranslitMap(): Readonly<Record<string, string>> {
  const path = fileURLToPath(new URL(TRANSLIT_MAP_RELATIVE_PATH, import.meta.url))
  const raw = readFileSync(path, 'utf-8')
  const parsed = JSON.parse(raw) as TranslitMapFile
  if (parsed.pairs === undefined) {
    throw new Error(`translit-map.json: отсутствует обязательное поле "pairs" (путь: ${path})`)
  }
  return parsed.pairs
}
