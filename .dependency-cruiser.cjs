/**
 * dependency-cruiser — машинная проверка Правила Зависимостей.
 * Источник правил: docs/02-CLEAN-ARCHITECTURE-AND-CODE.md §1 (backend) и §5 (frontend).
 *
 * Запуск: pnpm arch:check
 * Любое нарушение severity=error роняет CI. Это не рекомендация — это граница архитектуры.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- .cjs-конфиг, CommonJS require обязателен */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

/**
 * dependency-cruiser резолвит алиасы (`@/...`) через один "основной" tsconfig
 * (options.tsConfig.fileName). В этом монорепозитории у каждого apps/* и
 * packages/* — свой ЛОКАЛЬНЫЙ алиас `@/* -> ./src/*` (baseUrl у каждого пакета
 * свой), а корневой tsconfig.json (files: [], без "@/*") этот алиас вообще не
 * объявляет. Из-за этого при запуске из корня `@/shared/config/env` и подобные
 * валидные импорты внутри apps/web резолвились как "неизвестная зависимость"
 * (правило no-non-package-json), хотя `tsc --noEmit -p apps/web/tsconfig.json`
 * проходит чисто.
 *
 * dependency-cruiser не умеет принимать несколько tsconfig одновременно, но
 * TypeScript поддерживает fallback-массив кандидатов для одного алиаса:
 * `"@/*": ["apps/web/src/*", "apps/api/src/*", ...]` — резолвер перебирает их
 * по порядку и берёт первый реально существующий файл. Генерируем такой
 * синтетический tsconfig во временный файл на основе фактического списка
 * apps/* и packages/* (а не хардкодим один пакет), чтобы правило работало для
 * всего монорепо и не требовало правки при добавлении новых пакетов.
 */
function toPosixPath(fsPath) {
  return fsPath.split(path.sep).join('/')
}

function findWorkspaceSrcDirs(rootDir) {
  const workspaceDirs = ['apps', 'packages']
  const srcDirs = []
  for (const workspaceDir of workspaceDirs) {
    const workspaceAbsoluteDir = path.join(rootDir, workspaceDir)
    if (!fs.existsSync(workspaceAbsoluteDir)) continue
    for (const entry of fs.readdirSync(workspaceAbsoluteDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageDir = path.join(workspaceAbsoluteDir, entry.name)
      const hasTsconfig = fs.existsSync(path.join(packageDir, 'tsconfig.json'))
      const hasSrc = fs.existsSync(path.join(packageDir, 'src'))
      // apps/admin — scaffolding DTJ-075. ВОЗВРАЩЁН в анализ в волне 3.5
      // (STATE-AND-RESUME-POINT.md §11.4 задача 5.1): запрет Ж3 «не отключай
      // проверку ради зелёного гейта» требует, чтобы `apps/admin` был под
      // архитектурным контролем наравне с apps/web. Если у admin есть
      // собственные нарушения, они должны быть исправлены в admin, а не
      // вырезаны из проверки.
      if (hasTsconfig && hasSrc) {
        srcDirs.push(toPosixPath(path.join(workspaceDir, entry.name, 'src')))
      }
    }
  }
  return srcDirs
}

function writeDepcruiseTsconfig(rootDir) {
  // depcruise 17.x при включённом tsPreCompilationDeps вызывает tsc поверх
  // этого конфига, и tsc требует, чтобы каждый glob из `include` указывал
  // хотя бы на один существующий файл, иначе бросает TS18003.
  //
  // Соберём `include` как абсолютные пути, потому что baseUrl в синтетическом
  // конфиге не обязан совпадать с cwd депкруизы, и относительные globs от
  // cwd (корня монорепо) на Windows ломаются на glob-движке tsc.
  const srcDirs = findWorkspaceSrcDirs(rootDir)
  const tsconfig = {
    extends: toPosixPath(path.join(rootDir, 'tsconfig.base.json')),
    compilerOptions: {
      baseUrl: toPosixPath(rootDir),
      paths: { '@/*': srcDirs.map((srcDir) => `${srcDir}/*`) },
      noEmit: true,
      skipLibCheck: true,
    },
    include: srcDirs.map((srcDir) => `${toPosixPath(path.join(rootDir, srcDir))}/**/*`),
  }
  const tmpFile = path.join(os.tmpdir(), 'dorutj-depcruise-tsconfig.json')
  fs.writeFileSync(tmpFile, JSON.stringify(tsconfig))
  return tmpFile
}

const depcruiseTsconfigFileName = writeDepcruiseTsconfig(__dirname)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ═══════════════ ОБЩЕЕ ═══════════════ */
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Циклическая зависимость. Разорви её через доменное событие, порт или вынос общего кода вниз по слоям.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Устаревший модуль Node.js.',
      from: {},
      to: { dependencyTypes: ['core'], path: ['^(punycode|domain|sys|constants)$'] },
    },

    /* ═══════════════ BACKEND: Правило Зависимостей (§1.1) ═══════════════ */
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'Слой domain обязан быть чистым ядром: без фреймворков, ORM, БД, очередей и сети. ' +
        'Иначе бизнес-логика становится непроверяемой без инфраструктуры (§1.1).',
      from: { path: '/domain/' },
      to: {
        path: [
          'node_modules/@nestjs',
          'node_modules/drizzle-orm',
          'node_modules/pg',
          'node_modules/ioredis',
          'node_modules/bullmq',
          'node_modules/fastify',
          'node_modules/@fastify',
          'node_modules/pino',
          'node_modules/zod',
          'node_modules/axios',
          'node_modules/amqplib',
        ],
      },
    },
    {
      name: 'domain-does-not-depend-outward',
      severity: 'error',
      comment:
        'domain — самый внутренний слой. Он не знает ни об application, ни об infrastructure, ни о presentation (§1.1).',
      from: { path: '/domain/' },
      to: { path: '/(application|infrastructure|presentation)/' },
    },
    {
      name: 'application-does-not-know-infrastructure',
      severity: 'error',
      comment:
        'application объявляет порты, infrastructure их реализует. Импорт infrastructure из application ' +
        'ломает разворот зависимостей и делает use case непроверяемым (§1.1, §1.3).',
      from: { path: '/application/' },
      to: { path: '/(infrastructure|presentation)/' },
    },
    {
      name: 'presentation-goes-through-application',
      severity: 'error',
      comment:
        'Контроллер не имеет права знать доменные инварианты напрямую — только через use case (§1.1).',
      from: { path: '/presentation/' },
      to: { path: '/domain/' },
    },
    {
      name: 'no-db-schema-in-business-layers',
      severity: 'error',
      comment:
        'Схема БД (Drizzle) — деталь инфраструктуры. Её утечка в domain/application привязывает ' +
        'бизнес-логику к модели хранения (§1.1).',
      from: { path: '/(domain|application)/' },
      to: { path: '^apps/api/src/db/' },
    },

    /* ═══════════════ BACKEND: границы контекстов (§1.2) ═══════════════ */
    {
      name: 'no-cross-module-deep-import',
      severity: 'error',
      comment:
        'Межмодульное взаимодействие — ТОЛЬКО через публичный фасад modules/<context>/index.ts. ' +
        'Импорт внутренностей чужого модуля разрушает границу контекста (§1.2).',
      from: { path: '^apps/(api|worker)/src/modules/([^/]+)/' },
      to: {
        path: '^apps/(api|worker)/src/modules/([^/]+)/(domain|application|infrastructure|presentation)/',
        pathNot: '^apps/$1/src/modules/$2/',
      },
    },

    /* ═══════════════ FRONTEND: слои (§5) ═══════════════ */
    {
      name: 'fe-shared-is-lowest',
      severity: 'error',
      comment: 'shared — самый нижний слой, он не знает о вышестоящих (§5).',
      from: { path: '^apps/[^/]+/src/shared/' },
      to: { path: '^apps/[^/]+/src/(app|pages|features|entities)/' },
    },
    {
      name: 'fe-entities-below-features',
      severity: 'error',
      comment: 'entities не знают о features, pages и app (§5).',
      from: { path: '^apps/[^/]+/src/entities/' },
      to: { path: '^apps/[^/]+/src/(app|pages|features)/' },
    },
    {
      name: 'fe-features-are-isolated',
      severity: 'error',
      comment:
        'Горизонтальные импорты между фичами запрещены. Общее выносится в entities или shared (§5).',
      from: { path: '^apps/[^/]+/src/features/([^/]+)/' },
      to: {
        path: '^apps/[^/]+/src/features/([^/]+)/',
        pathNot: '^apps/[^/]+/src/features/$1/',
      },
    },
    {
      name: 'fe-features-below-pages',
      severity: 'error',
      comment: 'features не знают о pages и app (§5).',
      from: { path: '^apps/[^/]+/src/features/' },
      to: { path: '^apps/[^/]+/src/(app|pages)/' },
    },
    {
      name: 'fe-pages-below-app',
      severity: 'error',
      comment: 'pages не знают об app (§5).',
      from: { path: '^apps/[^/]+/src/pages/' },
      to: { path: '^apps/[^/]+/src/app/' },
    },

    /* ═══════════════ Гигиена ═══════════════ */
    {
      name: 'contracts-stay-portable',
      severity: 'error',
      comment:
        'packages/contracts — единый источник правды для API, его едят и бэкенд, и браузер. ' +
        'Серверные зависимости в нём сделают его неимпортируемым во фронтенде.',
      from: { path: '^packages/contracts/' },
      to: {
        path: [
          'node_modules/@nestjs',
          'node_modules/drizzle-orm',
          'node_modules/pg',
          'node_modules/ioredis',
          'node_modules/bullmq',
          'node_modules/fastify',
        ],
      },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment:
        'Приложения не импортируют друг друга — только через packages/*. ' +
        'Правило резолвит ЧЕРЕЗ ОТНОСИТЕЛЬНЫЕ ПУТИ в исходниках (включая `../`), ' +
        'а не через алиас `@/`, потому что depcruise не различает `@/*` ' +
        'между apps/* (fallback-массив путей, см. findWorkspaceSrcDirs). ' +
        'Алиас `@/shared/...` формально резолвится в apps/web/src/... ' +
        '(apps/web идёт первым), но при ошибке depcruise фоллбэкается в ' +
        'apps/admin/src/... — отсюда false-positive. Это правило ловит ' +
        'только РЕАЛЬНЫЕ относительные импорты, по которым невозможно ' +
        'ошибиться. См. STATE-AND-RESUME-POINT.md §11.4 задача 5.1.',
      from: { path: '^apps/([^/]+)/' },
      to: {
        // Ловим только relative-импорты с `../`, ведущие в чужой app.
        path: '\\.\\./.*/apps/([^/]+)/',
        pathNot: '\\.\\./.*/apps/$1/',
      },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Продуктовый код не должен зависеть от devDependencies.',
      from: {
        path: '^(apps|packages)/',
        // `.d.ts` — type-only файлы, которые легитимно ссылаются на типы из
        // dev-deps (например, `/// <reference types="vite/client" />`). Сами
        // `.d.ts` не компилируются в runtime-код, поэтому правило к ним
        // неприменимо (STATE-AND-RESUME-POINT.md §11.4 задача 5.1).
        // Дополнено артефактами того же класса, что уже исключённые: они физически не попадают
        // в продовый бандл. Отдельный случай — `a11y/test-utils.ts`: лежит в `src/` без суффикса
        // `.spec`, но импортируется только из спеков и намеренно отделён от `a11y-runtime`
        // (DTJ-404), чтобы `axe-core` не утекал в сборку. Проверено фактом: вхождений
        // `axe-core` в `dist/index.js` — ноль.
        pathNot:
          '\\.(test|spec)\\.(ts|tsx)$|/__tests__/|\\.config\\.|\\.d\\.ts$|/__fixtures__/|\\.stories\\.tsx$|/vitest\\.setup\\.ts$|/a11y/test-utils\\.ts$',
      },
      // `npm-peer` исключён осознанно: peerDependency — это контракт с потребителем, а не
      // dev-инструмент. Библиотечный пакет (`packages/ui`, `packages/i18n`) обязан объявлять
      // `react` как peer и обязан импортировать его в исходниках, иначе компонентов не бывает.
      // Правило считало это нарушением лишь потому, что `react` числится ещё и в
      // `devDependencies` — он нужен для локальной сборки и тестов, стандартная практика
      // React-библиотек. Уточнение формулировки, не ослабление: запрет на `devDependencies`
      // в продовом коде остаётся в силе.
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['npm-peer'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'Зависимость используется, но не объявлена в package.json.',
      from: {},
      to: { dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        '\\.(test|spec)\\.(ts|tsx)$',
        '/__tests__/',
        '/dist/',
        '/build/',
        '/coverage/',
        '/\\.turbo/',
        '/drizzle/',
        '\\.gen\\.ts$',
        // apps/admin (DTJ-075 scaffolding) — ВОЗВРАЩЁН в анализ в волне 3.5
        // (STATE-AND-RESUME-POINT.md §11.4 задача 5.1, запрет Ж3).
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: depcruiseTsconfigFileName },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
      text: { highlightFocused: true },
    },
    cache: false,
  },
}
