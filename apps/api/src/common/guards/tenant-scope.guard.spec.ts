/**
 * Тест `TenantScopeGuard` (DTJ-055, живучесть health/ready — SRS-NFR-037).
 *
 * Три группы кейсов:
 *   1. `@SkipTenantResolution()` пропускает маршрут ЦЕЛИКОМ, даже когда тенант
 *      не резолвлен (или контекст вообще не инициализирован) — это ЕДИНСТВЕННОЕ
 *      намеренное исключение, применяемое к liveness/readiness.
 *   2. Обычный бизнес-маршрут (без маркера) в тех же условиях по-прежнему
 *      получает отказ резолвинга — поведение для всех остальных маршрутов
 *      не меняется.
 *   3. `@Public()` и `@SkipTenantResolution()` — разные вещи: `@Public()` сам
 *      по себе НЕ снимает требование резолвинга (см. контракт, шаг 1 JSDoc гарда).
 */
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { TenantContext, type TenantContextStore } from '../context/tenant-context.js'
import { Public } from '../decorators/public.decorator.js'
import { SkipTenantResolution, TenantScopeGuard } from './tenant-scope.guard.js'

/** Строит `ExecutionContext`-заглушку: `getHandler`/`getClass` — единственное, что читает guard. */
function makeContext(handler: object, klass: object = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => klass,
  } as unknown as ExecutionContext
}

/** Функция-заглушка как цель для `SetMetadata`/`Reflect.defineMetadata` — тело не нужно, guard читает только метаданные. */
function fakeHandler(): () => void {
  return () => undefined
}

function unresolvedStore(reason: 'unknown_slug' | 'technical'): TenantContextStore {
  return TenantContext.forUnresolved(reason, 'acme')
}

function resolvedStore(): TenantContextStore {
  return TenantContext.forTenant({
    tenantId: '00000000-0000-4000-8000-000000000001',
    slug: 'neutral',
    chainId: null,
    isNeutral: true,
  })
}

describe('TenantScopeGuard (DTJ-055)', () => {
  const reflector = new Reflector()

  it('@SkipTenantResolution() пропускает маршрут, когда контекст вообще не инициализирован (нет middleware/нет строки)', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    SkipTenantResolution()(handler)
    const ctx = makeContext(handler)

    // Без `TenantContext.run(...)` — `TenantContext.get()` возвращает `undefined`.
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('@SkipTenantResolution() пропускает маршрут, когда тенант НЕ резолвлен (unresolved: technical)', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    SkipTenantResolution()(handler)
    const ctx = makeContext(handler)

    const result = TenantContext.run(unresolvedStore('technical'), () => guard.canActivate(ctx))
    expect(result).toBe(true)
  })

  it('@SkipTenantResolution() пропускает маршрут, когда тенант НЕ резолвлен (unresolved: unknown_slug)', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    SkipTenantResolution()(handler)
    const ctx = makeContext(handler)

    const result = TenantContext.run(unresolvedStore('unknown_slug'), () => guard.canActivate(ctx))
    expect(result).toBe(true)
  })

  it('обычный бизнес-маршрут (без маркера) в тех же условиях по-прежнему получает отказ резолвинга: unresolved technical → 500 INTERNAL_ERROR', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    const ctx = makeContext(handler)

    expect(() => TenantContext.run(unresolvedStore('technical'), () => guard.canActivate(ctx))).toThrow(
      UnauthorizedException,
    )
    try {
      TenantContext.run(unresolvedStore('technical'), () => guard.canActivate(ctx))
      expect.unreachable('canActivate обязан бросить на unresolved: technical')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException)
      const response = (error as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.INTERNAL_ERROR)
    }
  })

  it('обычный бизнес-маршрут (без маркера) в тех же условиях по-прежнему получает отказ резолвинга: unresolved unknown_slug → 404 UNKNOWN_TENANT_SLUG', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    const ctx = makeContext(handler)

    try {
      TenantContext.run(unresolvedStore('unknown_slug'), () => guard.canActivate(ctx))
      expect.unreachable('canActivate обязан бросить на unresolved: unknown_slug')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException)
      const response = (error as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.UNKNOWN_TENANT_SLUG)
    }
  })

  it('обычный бизнес-маршрут (без маркера) без TenantContext вообще (middleware не зарегистрирован) → 500 INTERNAL_ERROR', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    const ctx = makeContext(handler)

    try {
      guard.canActivate(ctx)
      expect.unreachable('canActivate обязан бросить, если TenantContext.get() === undefined')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException)
      const response = (error as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.INTERNAL_ERROR)
    }
  })

  it('@Public() САМ ПО СЕБЕ не снимает требование резолвинга: unresolved + @Public() → всё равно отказ', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    Public()(handler)
    const ctx = makeContext(handler)

    try {
      TenantContext.run(unresolvedStore('technical'), () => guard.canActivate(ctx))
      expect.unreachable('@Public() не должен пропускать unresolved-тенант')
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException)
      const response = (error as UnauthorizedException).getResponse() as { code: string }
      expect(response.code).toBe(ErrorCode.INTERNAL_ERROR)
    }
  })

  it('@Public() + резолвленный тенант → пропускает (в отличие от unresolved-кейса выше)', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    Public()(handler)
    const ctx = makeContext(handler)

    const result = TenantContext.run(resolvedStore(), () => guard.canActivate(ctx))
    expect(result).toBe(true)
  })

  it('резолвленный тенант без @Public() и без маркера → тоже пропускает (обычный бизнес-путь)', () => {
    const guard = new TenantScopeGuard(reflector)
    const handler = fakeHandler()
    const ctx = makeContext(handler)

    const result = TenantContext.run(resolvedStore(), () => guard.canActivate(ctx))
    expect(result).toBe(true)
  })
})
