/**
 * `tenant-resolution.middleware.spec.ts` (EP-02, DTJ-054, волна 3.5 задача 2.4
 * follow-up) — unit-тест нижнего слоя изоляции тенантов через
 * `TenantResolutionMiddleware`.
 *
 * Что проверяется (контракт, документированный в STATE-AND-RESUME-POINT.md
 * §11.4 задача 2.4: «создать данные тенанта A, запросить их от имени тенанта
 * B, убедиться в отказе»):
 *
 *   1. In-memory репозиторий с двумя реальными тенантами (apelsinka/farmonika)
 *      и одним нейтральным (neutral).
 *   2. Запрос с `X-Tenant-Slug: apelsinka` → `TenantContext.tenantId === id-апельсинки`,
 *      `chainId === chain-апельсинки`, `isNeutral === false`.
 *   3. Запрос с `X-Tenant-Slug: farmonika` → `TenantContext.tenantId === id-фермоники`,
 *      `chainId === chain-фермоники`, `isNeutral === false`. **Это критично** —
 *      утечки НЕТ: разные `slug` приводят к разным `tenantId`.
 *   4. Запрос с `X-Tenant-Slug: unknown-tenant` → `unresolved: true`,
 *      `unresolvedReason: 'unknown_slug'`. `tenantId === null`.
 *   5. Запрос без `X-Tenant-Slug` (только Host=null) → фоллбэк на `slug=neutral`,
 *      `isNeutral === true`, `tenantId === UUID нейтрального тенанта` (нейтральный —
 *      это shared-пул, НЕ привязан к chain, но резолвлен как настоящая запись
 *      в `tenants`, поэтому несёт реальный `tenantId`).
 *
 * Граница применимости: этот тест проверяет **нижний** слой изоляции — middleware
 * корректно резолвит тенанта из заголовка. Полный кросс-тенантный тест уровня
 * HTTP «JWT тенанта A → запрос к API тенанта B → 403 CROSS_TENANT_ACCESS_DENIED»
 * требует `AuthGuard` (DTJ-022, EP-01) и описан как `it.todo` в
 * `apps/api/test/integration/auth/phone-tenant-isolation.spec.ts`.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 2.4
 * @see apps/api/src/modules/tenancy/presentation/middleware/tenant-resolution.middleware.ts
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { Logger } from 'pino'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import {
  TENANT_CACHE,
  type TenantCachePort,
} from '@/modules/tenancy/application/ports/tenant-cache.port.js'
import {
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
  type TenantsListPage,
  type TenantsListQuery,
} from '@/modules/tenancy/application/ports/tenant-repository.port.js'
import type { Tenant } from '@/modules/tenancy/domain/tenant.entity.js'
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js'

/* ---------- In-memory test doubles ---------- */

interface TenantStub {
  readonly id: { value: string }
  readonly slug: { value: string }
  readonly chainId: { value: string } | null
  readonly isNeutral: boolean
  readonly customDomainStatus: {
    readonly isResolvedByDomain: () => boolean
  }
}

function makeTenant(args: {
  id: string
  slug: string
  chainId: string | null
  isNeutral: boolean
}): Tenant {
  const stub: TenantStub = {
    id: { value: args.id },
    slug: { value: args.slug },
    chainId: args.chainId === null ? null : { value: args.chainId },
    isNeutral: args.isNeutral,
    // По умолчанию customDomain не resolved-by-domain, чтобы Host-резолвинг
    // не срабатывал в этих тестах (мы тестируем X-Tenant-Slug путь).
    customDomainStatus: { isResolvedByDomain: () => false },
  }
  return stub as unknown as Tenant
}

class InMemoryTenantRepository implements TenantRepositoryPort {
  private readonly byId = new Map<string, TenantStub>()
  private readonly bySlug = new Map<string, TenantStub>()

  save(tenant: Tenant): Promise<void> {
    const stub = tenant as unknown as TenantStub
    this.byId.set(stub.id.value, stub)
    this.bySlug.set(stub.slug.value, stub)
    return Promise.resolve()
  }

  findById(id: TenantId): Promise<Tenant | null> {
    const found = this.byId.get(id.value)
    return Promise.resolve((found as Tenant | undefined) ?? null)
  }

  findBySlug(slug: string): Promise<Tenant | null> {
    const found = this.bySlug.get(slug)
    return Promise.resolve((found as Tenant | undefined) ?? null)
  }

  findByCustomDomain(domain: string): Promise<Tenant | null> {
    // Тесты проверяют только X-Tenant-Slug путь, Host-резолвинг не нужен.
    void domain
    return Promise.resolve(null)
  }

  findByChainId(chainId: TenantId): Promise<Tenant | null> {
    for (const tenant of this.byId.values()) {
      if (tenant.chainId?.value === chainId.value) {
        return Promise.resolve(tenant as Tenant)
      }
    }
    return Promise.resolve(null)
  }

  /** ДОБАВЛЕНО (DTJ-351) — не используется этим тестом (проверяет только резолвинг по slug/Host). */
  list(_query: TenantsListQuery): Promise<TenantsListPage> {
    return Promise.resolve({ items: [], nextCursor: null, hasMore: false })
  }
}

class InMemoryTenantCache implements TenantCachePort {
  private readonly byDomain = new Map<string, TenantId>()
  private readonly bySlug = new Map<string, TenantId>()

  getByDomain(host: string): Promise<TenantId | null> {
    return Promise.resolve(this.byDomain.get(host) ?? null)
  }

  getBySlug(slug: string): Promise<TenantId | null> {
    return Promise.resolve(this.bySlug.get(slug) ?? null)
  }

  setByDomain(host: string, tenantId: TenantId): Promise<void> {
    this.byDomain.set(host, tenantId)
    return Promise.resolve()
  }

  setBySlug(slug: string, tenantId: TenantId): Promise<void> {
    this.bySlug.set(slug, tenantId)
    return Promise.resolve()
  }

  invalidateDomain(host: string): Promise<void> {
    this.byDomain.delete(host)
    return Promise.resolve()
  }

  invalidateSlug(slug: string): Promise<void> {
    this.bySlug.delete(slug)
    return Promise.resolve()
  }
}

/** Минимальный no-op logger (middleware использует только `error`/`warn`). */
const SILENT_LOGGER = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  silent: () => undefined,
  child: () => SILENT_LOGGER,
  level: 'silent',
} as unknown as Logger

function makeMiddleware(repo: InMemoryTenantRepository, cache: InMemoryTenantCache): TenantResolutionMiddleware {
  return new TenantResolutionMiddleware(
    mapToken(TENANT_REPOSITORY, repo),
    mapToken(TENANT_CACHE, cache),
    mapToken(PINO_LOGGER, SILENT_LOGGER),
  )
}

/**
 * `@Inject(TOKEN)`-декоратор читает `TOKEN` через `design:paramtypes`, который в
 * runtime-инстансе не работает. Для unit-теста обходим через прямое
 * присваивание `private readonly` через `unknown`-каст (идентично тому, как
 * это делает NestJS DI-контейнер).
 */
function mapToken<T>(_token: symbol, value: T): T {
  return value
}

/** Сборка `IncomingMessage`-like объекта, достаточного для middleware. */
function makeReq(headers: Record<string, string | string[] | undefined>, url: string): IncomingMessage {
  const req = new Readable({ read: () => undefined }) as IncomingMessage
  req.headers = headers
  req.url = url
  return req
}

const NOOP_NEXT = (): void => undefined

/* ---------- Tests ---------- */

describe('TenantResolutionMiddleware — изоляция тенантов на уровне резолвинга (DTJ-054, wave 3.5 задача 2.4)', () => {
  const TENANT_A_ID = '00000000-0000-0000-0000-0000000000a1'
  const TENANT_B_ID = '00000000-0000-0000-0000-0000000000b1'
  const CHAIN_A_ID = '00000000-0000-0000-0000-000000000ca1'
  const CHAIN_B_ID = '00000000-0000-0000-0000-000000000cb1'
  const NEUTRAL_ID = '00000000-0000-0000-0000-0000000000n1'

  async function setupRepo(): Promise<InMemoryTenantRepository> {
    const repo = new InMemoryTenantRepository()
    await repo.save(makeTenant({ id: TENANT_A_ID, slug: 'apelsinka', chainId: CHAIN_A_ID, isNeutral: false }))
    await repo.save(makeTenant({ id: TENANT_B_ID, slug: 'farmonika', chainId: CHAIN_B_ID, isNeutral: false }))
    await repo.save(makeTenant({ id: NEUTRAL_ID, slug: 'neutral', chainId: null, isNeutral: true }))
    return repo
  }

  it('1. X-Tenant-Slug: apelsinka → tenantId=АПЕЛЬСИНКИ, chainId=ЦЕПЬ-А, isNeutral=false', async () => {
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    const req = makeReq({ 'x-tenant-slug': 'apelsinka' }, '/api/v1/medicines')
    const res = {} as ServerResponse

    let captured: TenantContextStore | undefined = undefined
    await mw.use(req, res, () => {
      captured = TenantContext.get()
      NOOP_NEXT()
    })

    expect(captured).toBeDefined()
    const store: TenantContextStore = captured!
    expect(store.tenantId).toBe(TENANT_A_ID)
    expect(store.slug).toBe('apelsinka')
    expect(store.chainId).toBe(CHAIN_A_ID)
    expect(store.isNeutral).toBe(false)
    expect(store.unresolved).toBe(false)
  })

  it('2. X-Tenant-Slug: farmonika → tenantId=ФЕРМОНИКИ, chainId=ЦЕПЬ-Б, isNeutral=false (НЕТ УТЕЧКИ)', async () => {
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    const req = makeReq({ 'x-tenant-slug': 'farmonika' }, '/api/v1/medicines')
    const res = {} as ServerResponse

    let captured: TenantContextStore | undefined = undefined
    await mw.use(req, res, () => {
      captured = TenantContext.get()
      NOOP_NEXT()
    })

    expect(captured).toBeDefined()
    const store: TenantContextStore = captured!
    expect(store.tenantId).toBe(TENANT_B_ID)
    expect(store.slug).toBe('farmonika')
    expect(store.chainId).toBe(CHAIN_B_ID)
    expect(store.isNeutral).toBe(false)
    // КРИТИЧНАЯ ПРОВЕРКА ИЗОЛЯЦИИ:
    expect(store.tenantId).not.toBe(TENANT_A_ID)
    expect(store.chainId).not.toBe(CHAIN_A_ID)
  })

  it('3. X-Tenant-Slug: unknown-tenant → unresolved=true, reason=unknown_slug, tenantId=null', async () => {
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    const req = makeReq({ 'x-tenant-slug': 'unknown-tenant' }, '/api/v1/medicines')
    const res = {} as ServerResponse

    let captured: TenantContextStore | undefined = undefined
    await mw.use(req, res, () => {
      captured = TenantContext.get()
      NOOP_NEXT()
    })

    expect(captured).toBeDefined()
    const store: TenantContextStore = captured!
    expect(store.unresolved).toBe(true)
    expect(store.unresolvedReason).toBe('unknown_slug')
    expect(store.tenantId).toBeNull()
  })

  it('4. Без X-Tenant-Slug и Host → фоллбэк на slug=neutral, isNeutral=true', async () => {
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    const req = makeReq({}, '/api/v1/medicines')
    const res = {} as ServerResponse

    let captured: TenantContextStore | undefined = undefined
    await mw.use(req, res, () => {
      captured = TenantContext.get()
      NOOP_NEXT()
    })

    expect(captured).toBeDefined()
    const store: TenantContextStore = captured!
    expect(store.isNeutral).toBe(true)
    expect(store.slug).toBe('neutral')
    // Нейтральный тенант — настоящая строка в `tenants` с настоящим UUID
    // (CTO-решение: не прятать id нейтрального тенанта за `null`, различие
    // «нейтральный / обычный» несёт `isNeutral`, не `tenantId`). Это shared-пул,
    // не привязанный к chain (`chainId === null`), но `tenantId` — реальный UUID.
    expect(store.tenantId).toBe(NEUTRAL_ID)
    expect(store.unresolved).toBe(false)
  })

  it('5. Telegram webhook путь исключён из резолвинга (SRS-TEN-026)', async () => {
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    // Путь Telegram-webhook — резолвинг НЕ выполняется, `next()` сразу.
    const req = makeReq({ 'x-tenant-slug': 'apelsinka' }, '/api/v1/webhooks/telegram/some-tenant-slug')
    const res = {} as ServerResponse

    let nextCalled = false
    await mw.use(req, res, () => {
      nextCalled = true
      NOOP_NEXT()
    })

    expect(nextCalled).toBe(true)
    // Контекст НЕ установлен — это правильно: Telegram-webhook делает
    // ручной резолв по `tenantSlug` из пути (DTJ-062).
    expect(TenantContext.get()).toBeUndefined()
  })

  it('6. Последовательные запросы с разными slug → разные tenantId в контексте', async () => {
    // Документирует инвариант: один middleware-инстанс НЕ кэширует
    // предыдущий резолв между запросами. Каждый `use()` — независимый резолв
    // в свежий `AsyncLocalStorage`-run.
    const repo = await setupRepo()
    const cache = new InMemoryTenantCache()
    const mw = makeMiddleware(repo, cache)
    const res = {} as ServerResponse

    const reqA = makeReq({ 'x-tenant-slug': 'apelsinka' }, '/api/v1/medicines')
    await mw.use(reqA, res, () => {
      const store = TenantContext.get()
      expect(store?.tenantId).toBe(TENANT_A_ID)
    })

    const reqB = makeReq({ 'x-tenant-slug': 'farmonika' }, '/api/v1/medicines')
    await mw.use(reqB, res, () => {
      const store = TenantContext.get()
      expect(store?.tenantId).toBe(TENANT_B_ID)
    })

    // Между вызовами контекст чистый.
    expect(TenantContext.get()).toBeUndefined()
  })
})
