// @ts-check
/**
 * ESLint flat config — принуждение правил Clean Code C1–C18.
 * Источник правил: docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §4 и §6.2.
 *
 * ПОЧЕМУ error, а не warn: правило, которое можно проигнорировать, не является правилом.
 * `pnpm lint` запускается с --max-warnings=0, поэтому warn всё равно уронил бы сборку,
 * но error делает намерение явным для разработчика.
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importX, { createNodeResolver } from 'eslint-plugin-import-x'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

/** Числа, которые не считаются «магическими»: индексы, флаги, база десятичной системы. */
const ALLOWED_NUMBERS = [-1, 0, 1, 2, 10, 100, 1000]

export default tseslint.config(
  // Ж4 (AGENTS.md §4) — запрет подавлений без обоснования. Встроенная опция ESLint
  // ловит подавления, которые ничего не подавляют (протухшие после рефакторинга),
  // а машинная проверка обоснований — в tests/arch/suppression-justification.spec.ts
  // (STATE-AND-RESUME-POINT.md §11.4 задача 5.4).
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    name: 'dorutj/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.gen.ts',
      '**/drizzle/**',
      // Локальное состояние инструментов, уже перечисленное в .gitignore. ESLint во flat-config
      // .gitignore НЕ читает, а `.claude/worktrees/**` содержит ПОЛНЫЕ копии репозитория от
      // агентских worktree — без этой строки `pnpm lint` линтит проект трижды, выдаёт 998
      // дублирующихся ошибок поверх 69 настоящих и падает с «JavaScript heap out of memory»
      // на 4 ГБ куче, то есть гейт физически не может завершиться.
      '.claude/**',
      '.serena/**',
      'apps/*_mobile/**',
      // Канвас Claude Design и его рантайм — сторонний артефакт, не наш продуктовый код.
      // Является обязательной визуальной ссылкой (docs/spec/32-design-reference.md), но не собирается.
      'Mobile app design planning/**',
      // DTJ-415: фикстуры-нарушители tests/arch/fixtures/** ДОЛЖНЫ падать при линте — это их
      // единственное назначение. Исключены из обычного `pnpm lint`/`pnpm verify`, чтобы не ронять
      // сборку остального репозитория; run-fixture-check.spec.ts таргетирует их явно через
      // `--no-ignore`, так что само правило остаётся проверяемым. tests/arch/*.spec.ts и
      // tests/arch/README.md сюда не входят — линтятся как обычный код.
      'tests/arch/fixtures/**',
      // Хелпер-скрипты разработчика (.cjs, не входят в build/test). Конфигурация
      // самого eslint делает это через `dorutj/configs` (files glob), но для
      // надёжности дублируем в ignores, чтобы случайная утилита в scripts/ не
      // роняла `pnpm lint`.
      'scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    name: 'dorutj/base',
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        // `allowDefaultProject` (DTJ-404): `*.stories.tsx` намеренно исключены из
        // `tsconfig.json` каждого пакета (Storybook собирается отдельно, не участвует в
        // `tsc --noEmit` продуктовой сборки) — без этого typescript-eslint падает с
        // parsing error «was not found by the project service» на каждом файле историй.
        // Глобы без `**` (typescript-eslint запрещает рекурсивный `**` в этой опции) —
        // перечислены явно по фактической глубине `src/components/<component>/*.stories.tsx`.
        projectService: {
          allowDefaultProject: [
            'packages/ui/src/components/*/*.stories.tsx',
            'packages/ui/src/components/*/*/*.stories.tsx',
          ],
          defaultProject: 'packages/ui/.storybook/tsconfig.json',
          // DTJ-405: DTJ-404 создал 8 файлов `*.stories.tsx` — ровно порог `allowDefaultProject`
          // по умолчанию (typescript-eslint предупреждает про производительность при >8). DTJ-405
          // добавил ещё 2 (`otp-input`/`phone-input`), порог превышен — явный числовой лимит вместо
          // ошибки парсинга. `*.stories.tsx` — Storybook-демонстрация, не продуктовый код,
          // производительность линтинга остаётся приемлемой при этом количестве файлов.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { 'import-x': importX },
    // Явный резолвер обязателен: без него import-x/no-cycle падает с необработанным
    // исключением "node with invalid interface loaded as resolver" при разборе
    // apps/web/vite.config.ts — легаси-резолвер по умолчанию (settings['import-x/resolver'])
    // при обходе графа импортов внутрь vite → @tailwindcss/vite → lightningcss натыкается на
    // директорию lightningcss/node (нативный биндинг пакета) и по чистому совпадению имени
    // ошибочно принимает её require() за резолвер с именем "node". Явный resolver-next
    // (современный интерфейс eslint-plugin-import-x, interfaceVersion 3) этот путь не использует.
    settings: { 'import-x/resolver-next': [createNodeResolver()] },
    rules: {
      /* ---------- C1–C5: измеримые пороги сложности ---------- */
      'max-lines-per-function': [
        'error',
        { max: 40, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      complexity: ['error', { max: 10 }],
      'max-depth': ['error', { max: 3 }],
      'max-params': ['error', { max: 3 }],
      'max-nested-callbacks': ['error', { max: 3 }],

      /* ---------- C6: магические числа и строки ---------- */
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: ALLOWED_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      /* ---------- C7: запрет any и подавления типов ---------- */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 15,
        },
      ],

      /* ---------- C8: мёртвый код ---------- */
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-unreachable': 'error',
      'no-useless-return': 'error',

      /* ---------- C9: логирование только через pino ---------- */
      'no-console': 'error',

      /* ---------- C10: именование ---------- */
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
        { selector: 'import', format: null },
      ],

      /* ---------- C12: честная обработка ошибок ---------- */
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-useless-catch': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',

      /* ---------- C13: неизменяемость ---------- */
      'prefer-const': 'error',
      'no-param-reassign': ['error', { props: true }],
      'no-var': 'error',

      /* ---------- C14: асинхронность ---------- */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      'no-await-in-loop': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      /* ---------- C16: импорты ---------- */
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*'],
              message:
                'Запрещены импорты через два и более уровня вверх (C16). Используй алиас @/... — см. docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §4.',
            },
          ],
        },
      ],

      /* ---------- Явные границы модулей ---------- */
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
    },
  },

  /* ---------- Слой domain: полная изоляция от фреймворков (§1.1) ---------- */
  {
    name: 'dorutj/domain-purity',
    files: ['**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'pg',
                'ioredis',
                'bullmq',
                'fastify',
                '@fastify/*',
                'zod',
                'pino',
                'axios',
                'node:fs',
                'node:http',
                'node:https',
                'fs',
                'http',
                'https',
                '**/infrastructure/**',
                '**/presentation/**',
                '**/application/**',
              ],
              message:
                'Слой domain обязан быть чистым: без фреймворков, БД, сети и внешних слоёв (docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §1.1).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'В domain время берётся через порт Clock (§2.6), а не через Date.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'В domain случайность берётся через порт IdGenerator (§2.6).' },
        { object: 'Date', property: 'now', message: 'В domain время берётся через порт Clock (§2.6).' },
        { object: 'process', property: 'env', message: 'domain не читает окружение (§2.6).' },
      ],
    },
  },

  /* ---------- Слой application: не знает об infrastructure (§1.1) ---------- */
  {
    name: 'dorutj/application-purity',
    files: ['**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/presentation/**', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'ioredis'],
              message:
                'application зависит только от domain и собственных портов; infrastructure реализует порты, но не импортируется (§1.1).',
            },
          ],
        },
      ],
    },
  },

  /* ---------- Frontend ---------- */
  {
    name: 'dorutj/frontend',
    files: ['apps/{web,admin,pharmacy,courier}/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'max-lines-per-function': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Сетевые вызовы — только через слой shared/api + TanStack Query (§5).' },
      ],
    },
  },

  /* ---------- Тесты: пороги сложности неприменимы ---------- */
  {
    name: 'dorutj/tests',
    files: ['**/*.{test,spec}.{ts,tsx}', 'tests/**/*.ts', '**/__tests__/**/*.ts', '**/*.fixture.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-await-in-loop': 'off',
    },
  },

  /* ---------- DTJ-415: фикстура magic-number держит правило C6 включённым ---------- */
  // 'dorutj/tests' выше намеренно выключает no-magic-numbers для файлов под tests/** — это
  // послабление для НАСТОЯЩИХ тестов (буквальные числа в assert-ах). Но фикстура
  // tests/arch/fixtures/magic-number/pricing.ts — не тест, а синтетический ПРОДУКТОВЫЙ код,
  // который обязан ловиться этим правилом (run-fixture-check.spec.ts на это рассчитывает).
  // Блок должен идти ПОСЛЕ 'dorutj/tests' по порядку массива, чтобы победить его 'off'.
  {
    name: 'dorutj/arch-fixture-magic-number',
    files: ['tests/arch/fixtures/magic-number/**/*.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: ALLOWED_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },

  /* ---------- Конфигурационные файлы ---------- */
  {
    name: 'dorutj/configs',
    files: [
      '**/*.config.{ts,mts,cts,js,mjs,cjs}',
      '**/*.{cjs,mjs}',
      '**/scripts/**/*.{ts,js,mjs,cjs}',
      '*.cjs',
      '*.mjs',
    ],
    languageOptions: {
      parserOptions: { projectService: false, project: null },
      globals: { ...globals.node },
    },
    rules: {
      // Отключаем ВСЕ правила, требующие информации о типах: конфигурационные файлы
      // не входят ни в один tsconfig, для них типовой линтинг невозможен.
      // ВАЖНО: раскрывать именно `.rules`, а не спредить весь конфиг —
      // иначе объект rules ниже полностью перезатрёт отключения.
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
      'no-magic-numbers': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'no-restricted-imports': 'off',
    },
  },

  prettierConfig,
)
