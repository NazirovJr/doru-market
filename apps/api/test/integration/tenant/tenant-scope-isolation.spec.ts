/**
 * Тест на утечку тенантных данных через `TenantScopeGuard` (DTJ-055, волна 3.5 задача 2.4).
 *
 * Что проверяется:
 *   1. Резолвленный тенант + `@Public()` маршрут — пропускается.
 *   2. Резолвленный тенант + непубличный маршрут — пропускается (AuthGuard
 *      не реализован в рамках волны 3.5, поэтому «token.tenantId === context.tenantId»
 *      будет проверяться в EP-01; здесь мы фиксируем только текущий DoD).
 *   3. `unresolved: true` + `unknown_slug` — 401 `UNKNOWN_TENANT_SLUG`.
 *   4. `unresolved: true` + `technical` — 401 `INTERNAL_ERROR` (нейтральный
 *      тенант не сконфигурирован, технический сбой).
 *   5. Полностью отсутствующий `TenantContext` (middleware не зарегистрирован) —
 *      401 `INTERNAL_ERROR`.
 *
 * Это unit-тест `TenantScopeGuard` через `Reflector` (мокаем) и подложенный
 * `TenantContext` (через `TenantContext.run`). Внешние БД не нужны.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 2.4
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { TenantContext } from '@/common/context/tenant-context.js'
import { TenantScopeGuard } from '@/common/guards/tenant-scope.guard.js'
import { PUBLIC_METADATA_KEY } from '@/common/decorators/public.decorator.js'

/** Минимальный мок `Reflector` (используется только `getAllAndOverride`). */
function makeReflector(publicKey: boolean | undefined) {
  return {
    getAllAndOverride: (_key: string, _targets: unknown[]): unknown => publicKey,
  }
}

const PUBLIC_TARGETS: unknown[] = []
const NON_PUBLIC_TARGETS: unknown[] = []

describe('TenantScopeGuard — изоляция тенантов (DTJ-055)', () => {
  let guard: TenantScopeGuard

  beforeEach(() => {
    guard = new TenantScopeGuard(makeReflector(undefined) as never)
  })

  it('пропускает резолвленного нейтрального тенанта на public-маршруте', () => {
    const reflector = new TenantScopeGuard(makeReflector(true) as never)
    const store = TenantContext.forTenant({
      tenantId: null,
      slug: 'neutral',
      chainId: null,
      isNeutral: true,
    })
    const result = TenantContext.run(store, () => reflector.canActivate(makeCtx(PUBLIC_TARGETS)))
    expect(result).toBe(true)
  })

  it('пропускает резолвленного тенанта сети на непубличном маршруте (DoD волны 3.5)', () => {
    const reflector = new TenantScopeGuard(makeReflector(undefined) as never)
    const store = TenantContext.forTenant({
      tenantId: '11111111-1111-1111-1111-111111111111',
      slug: 'apelsinka',
      chainId: '22222222-2222-2222-2222-222222222222',
      isNeutral: false,
    })
    const result = TenantContext.run(store, () => reflector.canActivate(makeCtx(NON_PUBLIC_TARGETS)))
    expect(result).toBe(true)
  })

  it('отклоняет unknown_slug → 401 UNKNOWN_TENANT_SLUG', () => {
    const reflector = new TenantScopeGuard(makeReflector(undefined) as never)
    const store = TenantContext.forUnresolved('unknown_slug', 'not-a-real-tenant')
    expect(() =>
      TenantContext.run(store, () => reflector.canActivate(makeCtx(NON_PUBLIC_TARGETS))),
    ).toThrow(UnauthorizedException)

    try {
      TenantContext.run(store, () => reflector.canActivate(makeCtx(NON_PUBLIC_TARGETS)))
    } catch (err) {
      const response = (err as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.UNKNOWN_TENANT_SLUG)
    }
  })

  it('отклоняет technical failure → 401 INTERNAL_ERROR', () => {
    const reflector = new TenantScopeGuard(makeReflector(undefined) as never)
    const store = TenantContext.forUnresolved('technical', 'neutral')
    try {
      TenantContext.run(store, () => reflector.canActivate(makeCtx(NON_PUBLIC_TARGETS)))
      throw new Error('expected UnauthorizedException')
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException)
      const response = (err as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.INTERNAL_ERROR)
    }
  })

  it('отклоняет запрос без TenantContext (middleware не зарегистрирован) → 401 INTERNAL_ERROR', () => {
    // НЕ вызываем TenantContext.run — store === undefined.
    try {
      guard.canActivate(makeCtx(NON_PUBLIC_TARGETS))
      throw new Error('expected UnauthorizedException')
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException)
      const response = (err as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.INTERNAL_ERROR)
    }
  })
})

/** Сборка `ExecutionContext`-подобного объекта, достаточного для guard'а. */
function makeCtx(_targets: unknown[]): Parameters<TenantScopeGuard['canActivate']>[0] {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => {
      throw new Error('not used in TenantScopeGuard')
    },
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => {
      throw new Error('not used')
    },
    switchToWs: () => {
      throw new Error('not used')
    },
    getType: () => 'http',
  } as never
}

// Чтобы TS не ругался на неиспользуемый импорт `PUBLIC_METADATA_KEY` (он нужен только
// для типа в `Reflector`-моке; в рантайме используется через metadata-ключ в NestJS).
void PUBLIC_METADATA_KEY
