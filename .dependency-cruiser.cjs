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
      if (hasTsconfig && hasSrc) {
        srcDirs.push(toPosixPath(path.join(workspaceDir, entry.name, 'src')))
      }
    }
  }
  return srcDirs
}

function writeDepcruiseTsconfig(rootDir) {
  const tsconfig = {
    compilerOptions: {
      baseUrl: toPosixPath(rootDir),
      paths: { '@/*': findWorkspaceSrcDirs(rootDir).map((srcDir) => `${srcDir}/*`) },
    },
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
      comment: 'Приложения не импортируют друг друга — только через packages/*.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Продуктовый код не должен зависеть от devDependencies.',
      from: { path: '^(apps|packages)/', pathNot: '\\.(test|spec)\\.(ts|tsx)$|/__tests__/|\\.config\\.' },
      to: { dependencyTypes: ['npm-dev'] },
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
