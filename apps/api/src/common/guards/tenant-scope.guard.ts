/**
 * `TenantScopeGuard` (DTJ-055) — гарантирует, что ЛЮБОЙ защищённый эндпоинт
 * выполняется ТОЛЬКО при наличии резолвленного тенанта. Это второй контур после
 * `TenantResolutionMiddleware` (DTJ-054): middleware ставит `unresolved: true`
 * в `TenantContext`, а guard превращает это в корректный HTTP-ответ.
 *
 * Контракт (SRS-TEN-008, SRS-API-041):
 *   0. Endpoint помечен `@SkipTenantResolution()` — guard пропускает ВСЮ
 *      проверку резолвинга целиком (см. JSDoc декоратора ниже). Это НЕ то же
 *      самое, что `@Public()` (шаг 1): `@Public()` до сих пор требует
 *      успешно резолвленного (хотя бы нейтрального) тенанта.
 *   1. Endpoint помечен `@Public()` — guard пропускает проверку
 *      `token.tenantId === resolvedTenantId` (это работа `AuthGuard`,
 *      ещё не написан в рамках волны 3.5), НО проверка резолва тенанта
 *      ОБЯЗАТЕЛЬНА даже для public-маршрутов. Без резолва — 400.
 *   2. `unresolved: true` + `unresolvedReason: 'unknown_slug'` → 404
 *      `UNKNOWN_TENANT_SLUG` (запрошенный slug не найден).
 *   3. `unresolved: true` + `unresolvedReason: 'technical'` → 500
 *      `INTERNAL_ERROR` (не нашли даже нейтральный тенант; технический сбой).
 *   4. Резолвленный тенант — пропускаем запрос. `super_admin` override
 *      (SRS-TEN-010) пока закомментирован как TODO: эпик EP-15 добавит
 *      cross-tenant операции под отдельным гардом, чтобы здесь guard
 *      оставался простым и проверяемым.
 *
 * Guard НЕ импортирует ничего из `domain/tenancy` — только `TenantContext` и
 * `ErrorCode` из `packages/contracts`. Это соответствует §1.1
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md`: presentation зависит только от
 * application (порт `TenantContext` — это application-инфраструктура, не
 * domain).
 */
import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode } from '@dorutj/contracts'
import { TenantContext } from '../context/tenant-context.js'
import { PUBLIC_METADATA_KEY } from '../decorators/public.decorator.js'

/**
 * Маркер живучести (SRS-NFR-037): по умолчанию `TenantScopeGuard` требует
 * успешно резолвленного тенанта (хотя бы нейтрального) для ЛЮБОГО маршрута,
 * включая `@Public()` (см. шаг 1 контракта выше) — так и должно оставаться
 * для всех бизнес-маршрутов.
 *
 * Единственное намеренное исключение — liveness/readiness (`/health`,
 * `/ready`, см. `HealthController`): проба живучести обязана отвечать даже
 * когда тенанты вообще не заведены в БД (пустая `tenants` до применения
 * seed/миграции нейтрального тенанта), иначе Docker/K8s healthcheck не может
 * отличить «приложение упало» от «справочники пока пустые» — получается
 * замкнутый круг (см. миграцию `0021_seed_neutral_tenant.sql`, JSDoc).
 *
 * Инвариант (РАСШИРЕН DTJ-242): изначально — ТОЛЬКО health/readiness-маршруты. Второй
 * легитимный случай — входящие вебхуки ВНЕШНИХ системных принципалов (`PaymentsWebhookController`,
 * `POST /api/v1/payments/webhook`), у которых нет тенантной идентичности вовсе (банк не
 * присылает ни `Host`/slug, ни JWT) — тенант резолвится ВНУТРИ use case через доменные данные
 * (`payment_operations.provider_ref → orders.tenant_id`), не через `TenantContext`. Оба случая
 * объединяет одно: маршрут структурно не может нести тенантную идентичность на транспортном
 * уровне — не «временное упрощение», а свойство самого маршрута.
 * Он специально не переиспользует `@Public()` — `@Public()` уже применяется
 * к другим бизнес-эндпоинтам (`otp-request`, `telegram-auth` и т.д.), которым
 * резолвинг тенанта по-прежнему обязателен. Смешивать эти два маркера означало
 * бы ослабить проверку для всех public-маршрутов сразу, а не только для перечисленных здесь.
 */
export const SKIP_TENANT_RESOLUTION_KEY = Symbol.for('@dorutj/common/skip-tenant-resolution')

/** См. `SKIP_TENANT_RESOLUTION_KEY`. Применять ТОЛЬКО к liveness/readiness. */
export const SkipTenantResolution = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_RESOLUTION_KEY, true)

@Injectable()
export class TenantScopeGuard implements CanActivate {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` (DTJ-001). Без него
  // paramtypes пуст, guard создаётся без аргументов и `this.reflector` — undefined; бут при
  // этом НЕ падает, а TypeError прилетает на первом же запросе. Guard глобальный (APP_GUARD),
  // поэтому цена ошибки — все эндпоинты сразу. Та же конвенция уже соблюдена в
  // `modules/auth/presentation/guards/auth.guard.ts` и `roles.guard.ts`.
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skipTenantResolution = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_RESOLUTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skipTenantResolution) {
      return true
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    const store = TenantContext.get()
    // Шаг 1: резолвинг ОБЯЗАН был выполниться (middleware обязан стоять ДО guard'а).
    // Если контекст отсутствует вовне — это архитектурный дефект, а не «нет тенанта»:
    // middleware не зарегистрирован. 500 `INTERNAL_ERROR` (не 400), чтобы отличить
    // «не настроено» от «не нашли».
    if (store === undefined) {
      throw new UnauthorizedException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'tenant context not initialized (middleware not registered)',
      })
    }

    // Шаг 2: нерезолвленный тенант.
    if (store.unresolved) {
      if (store.unresolvedReason === 'unknown_slug') {
        throw new UnauthorizedException({
          code: ErrorCode.UNKNOWN_TENANT_SLUG,
          message: `tenant slug not found: ${store.slug}`,
        })
      }
      // 'technical' — нейтральный тенант не найден, база/seed сломаны.
      throw new UnauthorizedException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'neutral tenant not configured',
      })
    }

    // Шаг 3: тенант резолвлен. Проверку `token.tenantId === tenantId` сделает
    // отдельный `AuthGuard` (DTJ-022, ещё не подключён в рамках волны 3.5).
    // Здесь — только факт «тенант есть и не зафейлен».
    if (isPublic) {
      return true
    }

    // TODO(EP-15): super_admin override для cross-tenant операций (SRS-TEN-010).
    // Сейчас guard просто пропускает резолвленный тенант — этого достаточно для
    // всех R1-эндпоинтов, кроме админских, которые появятся в EP-15.
    return true
  }
}
