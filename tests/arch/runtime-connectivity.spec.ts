/**
 * Runtime-connectivity check (STATE-AND-RESUME-POINT.md §11.7, задача «к волне 4 добавить
 * автоматический тест на подключённость»). Цель — гарантировать, что код, написанный
 * в тикете, ФИЗИЧЕСКИ УЧАСТВУЕТ в рантайме NestJS, а не просто лежит в `src/` как
 * неиспользуемый модуль.
 *
 * Дефект A (STATE-AND-RESUME-POINT.md §11.2): `TenantResolutionMiddleware` был написан,
 * но в `app.module.ts` остался комментарий «EP-02 добавит позже» — ни один запрос не
 * резолвил тенанта. Зелёный `pnpm lint` / `pnpm typecheck` / `pnpm test` не ловили это,
 * потому что они проверяют ФОРМУ кода, а не УЧАСТИЕ в `AppModule`. Этот тест — страховка
 * от повторения.
 *
 * Что проверяется (текстовый парсинг `app.module.ts` + модулей, без AST-зависимостей,
 * чтобы тест работал в любой песочнице):
 *   1. Каждый `modules/<context>/<context>.module.ts` имеет класс `<Context>Module`,
 *      упомянутый в `imports: [...]` `AppModule`.
 *   2. `TenantResolutionMiddleware` упомянут в `consumer.apply(...)` в `AppModule.configure()`.
 *   3. `TenantScopeGuard` упомянут в `TenancyModule.providers` через `APP_GUARD`.
 *   4. `AuthNotReadyInterceptor` УДАЛЁН (задача 6 EP-01: Auth закрыт, @AuthNotReady() снят).
 *   5. `MedicinesController` упомянут в `CatalogModule.controllers` (защита от дефекта D —
 *      «у каталога ноль HTTP-эндпоинтов»).
 *   6. Существует `apps/api/src/main.ts` (точка входа NestJS).
 *
 * Тест НЕ парсит AST — только регулярные выражения, потому что `app.module.ts` имеет
 * стабильный шаблон «импорт класса + строка в массиве». Это сознательное упрощение:
 * полноценный AST-парсер (`typescript` API) подключит EP-19 при желании.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.7
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../..')
const APP_ROOT = path.join(REPO_ROOT, 'apps/api')
const APP_MODULE_PATH = path.join(APP_ROOT, 'src/app.module.ts')
const MODULES_DIR = path.join(APP_ROOT, 'src/modules')
const MAIN_PATH = path.join(APP_ROOT, 'src/main.ts')

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

/** Имя класса модуля по каталогу (catalog.module.ts → CatalogModule). */
function moduleClassName(moduleDir: string): string {
  const base = path.basename(moduleDir, '.module.ts')
  return base.charAt(0).toUpperCase() + base.slice(1) + 'Module'
}

interface DiscoveredModule {
  readonly context: string
  readonly moduleClass: string
  readonly modulePath: string
}

function discoverApiModules(): readonly DiscoveredModule[] {
  if (!fs.existsSync(MODULES_DIR)) {
    return []
  }
  const result: DiscoveredModule[] = []
  for (const entry of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const context = entry.name
    const modulePath = path.join(MODULES_DIR, context, `${context}.module.ts`)
    if (!fs.existsSync(modulePath)) continue
    result.push({ context, moduleClass: moduleClassName(context), modulePath })
  }
  return result
}

describe('Runtime connectivity — код, который не подключён, не считается готовым (STATE §11.7)', () => {
  it('apps/api/src/main.ts существует (точка входа NestJS)', () => {
    expect(fs.existsSync(MAIN_PATH), `${MAIN_PATH} должен существовать`).toBe(true)
  })

  it('apps/api/src/app.module.ts существует', () => {
    expect(fs.existsSync(APP_MODULE_PATH), `${APP_MODULE_PATH} должен существовать`).toBe(true)
  })

  describe('AppModule импортирует каждый модуль из apps/api/src/modules/*', () => {
    const appModuleText = readFile(APP_MODULE_PATH)
    const modules = discoverApiModules()

    // sanity-check: у нас должны быть модули, иначе тест бесполезен.
    expect(modules.length).toBeGreaterThan(0)

    for (const { context, moduleClass, modulePath } of modules) {
      it(`${context}: ${moduleClass} подключён в AppModule.imports`, () => {
        // Два способа попасть в `imports`: прямая строка (`ModuleClass`) или через алиас
        // (`<Context>Module as ModuleClass`). Проверяем упоминание имени класса.
        const isImported = new RegExp(`\\b${moduleClass}\\b`).test(appModuleText)
        expect(
          isImported,
          `${moduleClass} из ${path.relative(REPO_ROOT, modulePath)} ` +
            `должен быть в imports: [] AppModule. Текущий app.module.ts: \n${appModuleText}`,
        ).toBe(true)
      })
    }
  })

  describe('AppModule.configure() подключает критичные middleware/guards', () => {
    const appModuleText = readFile(APP_MODULE_PATH)

    /**
     * Находит аргументы `.apply(...)` в `configure(consumer)`. Использует ЖАДНЫЙ
     * `[\s\S]+` без флага `u` — это сделано СОЗНАТЕЛЬНО: lazy `[\s\S]+?` отказывается
     * ловить переносы строк в V8 (node 22.12) при наличии соседних скобок; greedy
     * работает стабильно, а совпадение останавливается на ПЕРВОМ `).forRoutes(`.
     * Защита от ложного совпадения с сигнатурой `consumer: MiddlewareConsumer`:
     * дополнительный guard ниже, что `idx > 0` и до найденного `.apply` встречается
     * слово `MiddlewareConsumer`.
     */
    function findApplyArgs(): string {
      const m = /\.apply\(([\s\S]+)\)\s*\.forRoutes\(/g.exec(appModuleText)
      if (m?.[1] === undefined) {
        throw new Error('В AppModule.configure() должен быть `consumer.apply(...).forRoutes(...)`')
      }
      const start = m.index
      const before = appModuleText.slice(0, start)
      if (!before.includes('MiddlewareConsumer')) {
        throw new Error('`.apply(...)` найден, но НЕ внутри `configure(consumer: MiddlewareConsumer)`')
      }
      return m[1]
    }

    it('TenantResolutionMiddleware упоминается в consumer.apply(...) (дефект A)', () => {
      const args = findApplyArgs()
      expect(
        args.includes('TenantResolutionMiddleware'),
        'TenantResolutionMiddleware должен быть в consumer.apply(...) — иначе ни один ' +
          'запрос не резолвит тенанта (дефект A, STATE-AND-RESUME-POINT.md §11.2).',
      ).toBe(true)
    })

    it('RequestContextMiddleware и HttpLoggerMiddleware идут ДО TenantResolutionMiddleware', () => {
      // §1.1 чистой архитектуры: `requestId` должен быть в `RequestContext` ДО резолва
      // тенанта, иначе ошибки резолвинга останутся без трассировки. Проверяем порядок.
      const args = findApplyArgs()
      const idxRequest = args.indexOf('RequestContextMiddleware')
      const idxHttp = args.indexOf('HttpLoggerMiddleware')
      const idxTenant = args.indexOf('TenantResolutionMiddleware')
      expect(idxRequest).toBeGreaterThanOrEqual(0)
      expect(idxHttp).toBeGreaterThanOrEqual(0)
      expect(idxTenant).toBeGreaterThanOrEqual(0)
      expect(
        idxRequest < idxTenant,
        'RequestContextMiddleware должен идти ДО TenantResolutionMiddleware в consumer.apply(...)',
      ).toBe(true)
      expect(
        idxHttp < idxTenant,
        'HttpLoggerMiddleware должен идти ДО TenantResolutionMiddleware в consumer.apply(...)',
      ).toBe(true)
    })
  })

  describe('TenancyModule регистрирует критичные провайдеры', () => {
    const tenancyModulePath = path.join(MODULES_DIR, 'tenancy/tenancy.module.ts')
    const tenancyText = readFile(tenancyModulePath)

    it('TenantScopeGuard зарегистрирован через APP_GUARD (дефект B)', () => {
      expect(
        tenancyText.includes('APP_GUARD') && tenancyText.includes('TenantScopeGuard'),
        'TenancyModule должен содержать `{ provide: APP_GUARD, useClass: TenantScopeGuard }`.',
      ).toBe(true)
    })

    it('AuthNotReadyInterceptor НЕ регистрируется (задача 6, EP-01 закрыт)', () => {
      expect(
        !tenancyText.includes('AuthNotReadyInterceptor'),
        'AuthNotReadyInterceptor удалён в EP-01/DTJ-022: @AuthNotReady() больше не используется.',
      ).toBe(true)
    })

    it('TenantResolutionMiddleware экспортируется из TenancyModule (иначе AppModule не может его подключить)', () => {
      expect(
        tenancyText.includes('exports:') && tenancyText.includes('TenantResolutionMiddleware'),
        'TenancyModule.exports должен включать TenantResolutionMiddleware.',
      ).toBe(true)
    })
  })

  describe('AuthModule предоставляет AuthGuard и RolesGuard (EP-01, DTJ-022)', () => {
    const authModulePath = path.join(MODULES_DIR, 'auth/auth.module.ts')
    const appModuleText = readFile(APP_MODULE_PATH)

    it('AuthModule существует', () => {
      expect(fs.existsSync(authModulePath), 'AuthModule должен существовать').toBe(true)
    })

    it('Rs256JwtSignerAdapter зарегистрирован в providers: [...]', () => {
      const hasProviders = /providers:\s*\[([\s\S]+)\]/g.exec(readFile(authModulePath))
      const inner = hasProviders?.[1] ?? ''
      expect(
        inner.includes('Rs256JwtSignerAdapter'),
        'Rs256JwtSignerAdapter должен быть в providers: [] AuthModule — иначе JWT нечем подписывать.',
      ).toBe(true)
    })

    it('AuthGuard и RolesGuard экспортируются из AuthModule', () => {
      const text = readFile(authModulePath)
      expect(
        text.includes('AuthGuard') && text.includes('RolesGuard'),
        'AuthGuard и RolesGuard должны быть в exports AuthModule — иначе контроллеры не смогут их импортировать.',
      ).toBe(true)
    })

    it('AuthModule импортирован в AppModule.imports', () => {
      const importsMatch = /imports:\s*\[([\s\S]+)\]/g.exec(appModuleText)
      const inner = importsMatch?.[1] ?? ''
      expect(
        inner.includes('AuthModule'),
        'AuthModule должен быть в imports: [] AppModule.',
      ).toBe(true)
    })

    it('Ни один контроллер не использует @AuthNotReady() (задача 6)', () => {
      // Рекурсивно ищем упоминания @AuthNotReady() во всех .ts под apps/api/src.
      // Если находится хоть одно — задача 6 EP-01 не закрыта.
      const buf: string[] = []
      const walk = (dir: string): void => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name)
          if (ent.isDirectory()) {
            walk(full)
          } else if (ent.name.endsWith('.ts')) {
            const text = readFile(full)
            if (text.includes('@AuthNotReady()') || text.includes('AuthNotReady(')) {
              buf.push(full)
            }
          }
        }
      }
      walk(path.join(APP_ROOT, 'src'))
      expect(
        buf,
        'Ни один файл не должен импортировать @AuthNotReady() после закрытия EP-01. ' +
          'Оставшиеся файлы: ' + buf.join(', '),
      ).toEqual([])
    })
  })

  describe('CatalogModule регистрирует контроллер (защита от дефекта D)', () => {
    const catalogModulePath = path.join(MODULES_DIR, 'catalog/catalog.module.ts')
    const catalogText = readFile(catalogModulePath)

    it('MedicinesController упоминается в controllers: [...]', () => {
      const hasControllers = /controllers:\s*\[([\s\S]+)\]/g.exec(catalogText)
      expect(
        hasControllers,
        'CatalogModule должен объявлять `controllers: [...]`.',
      ).not.toBeNull()
      const inner = hasControllers?.[1] ?? ''
      expect(
        inner.includes('MedicinesController'),
        'MedicinesController должен быть в controllers: [] CatalogModule — иначе у каталога ' +
          'ноль HTTP-эндпоинтов (дефект D, STATE-AND-RESUME-POINT.md §11.2).',
      ).toBe(true)
    })

    it('CategoriesController упоминается в controllers: [...] (DTJ-094)', () => {
      const hasControllers = /controllers:\s*\[([\s\S]+)\]/g.exec(catalogText)
      const inner = hasControllers?.[1] ?? ''
      expect(
        inner.includes('CategoriesController'),
        'CategoriesController должен быть в controllers: [] CatalogModule (DTJ-094, EP-04 / Волна 4).',
      ).toBe(true)
    })
  })

  describe('InventoryModule регистрирует контроллер и провайдеры (DTJ-140, DTJ-157)', () => {
    const inventoryModulePath = path.join(MODULES_DIR, 'inventory/inventory.module.ts')
    const inventoryText = readFile(inventoryModulePath)
    const appModuleText = readFile(APP_MODULE_PATH)

    it('InventoryModule существует', () => {
      expect(fs.existsSync(inventoryModulePath), 'InventoryModule должен существовать').toBe(true)
    })

    it('InventoryBatchUpdateController упоминается в controllers: [...] (DTJ-157)', () => {
      const hasControllers = /controllers:\s*\[([\s\S]+)\]/g.exec(inventoryText)
      const inner = hasControllers?.[1] ?? ''
      expect(
        inner.includes('InventoryBatchUpdateController'),
        'InventoryBatchUpdateController должен быть в controllers: [] InventoryModule.',
      ).toBe(true)
    })

    it('IngestInventoryBatchUseCase зарегистрирован в providers: [...] (DTJ-148)', () => {
      const hasProviders = /providers:\s*\[([\s\S]+)\]/g.exec(inventoryText)
      const inner = hasProviders?.[1] ?? ''
      expect(
        inner.includes('IngestInventoryBatchUseCase'),
        'IngestInventoryBatchUseCase должен быть в providers: [] InventoryModule — иначе ' +
          'контроллер не получит инжекцию.',
      ).toBe(true)
    })

    it('InventoryModule импортирован в AppModule.imports', () => {
      const importsMatch = /imports:\s*\[([\s\S]+)\]/g.exec(appModuleText)
      const inner = importsMatch?.[1] ?? ''
      expect(
        inner.includes('InventoryModule'),
        'InventoryModule должен быть в imports: [] AppModule — иначе контроллер не зарегистрируется.',
      ).toBe(true)
    })
  })
})
