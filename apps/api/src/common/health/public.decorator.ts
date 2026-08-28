import { SetMetadata, type CustomDecorator } from '@nestjs/common'

export const IS_PUBLIC_ROUTE_KEY = 'isPublicRoute'

/**
 * Временный маркер маршрута, не требующего тенант-резолвинга/аутентификации (DTJ-001,
 * шаг 6). В этом тикете применяется ТОЛЬКО к `/health` и `/ready` (SRS-NFR-037: «оба
 * эндпоинта — вне TenantResolutionMiddleware и вне аутентификации»).
 *
 * ВАЖНО для EP-02: `TenantResolutionMiddleware` ОБЯЗАН читать этот маркер через
 * `Reflector` (ключ `IS_PUBLIC_ROUTE_KEY`) и пропускать помеченные маршруты — иначе
 * `/health`/`/ready` начнут требовать тенанта и сломают liveness/readiness проверки деплоя.
 *
 * ВАЖНО для DTJ-022 (JWT `AuthGuard`): если вводится собственный механизм публичных
 * маршрутов — переиспользовать ИМЕННО этот декоратор (см. «Риски» тикета DTJ-001), не
 * заводить второй `@Public()`.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_ROUTE_KEY, true)
