/**
 * `TenantResolutionMiddleware` (DTJ-054) — единственное место, где по `Host`/
 * `X-Tenant-Slug` определяется тенант запроса. Регистрируется СТРОГО ПОСЛЕ
 * `RequestContextMiddleware` (в `app.module.ts`), чтобы `requestId` уже был
 * в `RequestContext` для трассировки ошибок резолвинга.
 *
 * Алгоритм СТРОГО по приоритету (SRS-API-041):
 *   1. Host → cache.getByDomain → repo.findByCustomDomain (только если
 *      customDomainStatus === 'verified')
 *   2. X-Tenant-Slug → cache.getBySlug → repo.findBySlug
 *      (если `X-Tenant-Slug` задан и slug не найден → `unknown_slug`)
 *   3. Neutral fallback → repo.findBySlug('neutral')
 *
 * Middleware НЕ бросает HTTP-исключение (Fastify-миддлвары плохо совместимы
 * с `DomainExceptionFilter`) — ставит `unresolved: true` в контекст, а
 * `TenantScopeGuard` (DTJ-055) уже формирует финальный ответ.
 */
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger } from 'pino'
import { TenantContext } from '@/common/context/tenant-context.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { TENANT_CACHE, type TenantCachePort } from '@/modules/tenancy/application/ports/tenant-cache.port.js'
import {
  TENANT_REPOSITORY,
  type TenantRepositoryPort,
} from '@/modules/tenancy/application/ports/tenant-repository.port.js'

const TENANT_SLUG_HEADER = 'x-tenant-slug'
const NEUTRAL_SLUG = 'neutral'
/**
 * Пути, исключённые из резолвинга (DTJ-062: Telegram webhook несёт tenantSlug
 * в пути, не в заголовке). Это ЕДИНСТВЕННОЕ задокументированное исключение
 * (SRS-TEN-026).
 */
export const TENANT_RESOLUTION_EXCLUDED_PATHS: readonly RegExp[] = [
  /^\/api\/v1\/webhooks\/telegram\/[^/]+$/u,
]

interface HostAndSlug {
  host: string | null
  slug: string | null
}

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenantRepo: TenantRepositoryPort,
    @Inject(TENANT_CACHE) private readonly cache: TenantCachePort,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  async use(req: IncomingMessage, _res: ServerResponse, next: () => void): Promise<void> {
    const url = req.url ?? '/'
    if (TENANT_RESOLUTION_EXCLUDED_PATHS.some((re) => re.test(url))) {
      next()
      return
    }

    const { host, slug } = extractResolutionInputs(req)
    try {
      const store = await this.resolve(host, slug)
      TenantContext.run(store, next)
    } catch (error: unknown) {
      // Штатный путь — `resolve()` НИКОГДА не должен бросать, любой сбой
      // превращается в `unresolved: 'technical'`. Здесь — ловушка на случай
      // непредвиденного исключения (например, из `extractResolutionInputs`),
      // не дающая запросу упасть 500-кой без контекста.
      this.logger.error({ err: error, host, slug }, 'tenant_resolution_unexpected_error')
      TenantContext.run(TenantContext.forUnresolved('technical', slug ?? NEUTRAL_SLUG), next)
    }
  }

  private async resolve(host: string | null, slug: string | null) {
    // Шаг 1: Host
    if (host !== null && host.length > 0) {
      const byHost = await this.resolveByHost(host, slug)
      if (byHost !== null) {
        return byHost
      }
    }

    // Шаг 2: X-Tenant-Slug
    if (slug !== null && slug.length > 0) {
      return this.resolveBySlug(slug)
    }

    // Шаг 3: Neutral fallback
    return this.resolveNeutral(host, slug)
  }

  /** Шаг 1 алгоритма: резолв по `Host` через cache+repo, фильтр `isResolvedByDomain`. */
  private async resolveByHost(host: string, slug: string | null) {
    const cached = await this.cache.getByDomain(host)
    const tenant =
      cached !== null
        ? await this.tenantRepo.findById(cached)
        : await this.tenantRepo.findByCustomDomain(host)
    if (tenant?.customDomainStatus.isResolvedByDomain() !== true) {
      return null
    }
    await this.cache.setByDomain(host, tenant.id)
    if (slug !== null && slug !== tenant.slug.value) {
      // `X-Tenant-Slug` проигнорирован, но конфликт с Host — логируем.
      this.logger.warn(
        { host, hostSlug: tenant.slug.value, headerSlug: slug },
        'tenant_slug_header_conflicts_with_host',
      )
    }
    return TenantContext.forTenant({
      tenantId: tenant.id.value,
      slug: tenant.slug.value,
      chainId: tenant.chainId?.value ?? null,
      isNeutral: tenant.isNeutral,
    })
  }

  /** Шаг 2 алгоритма: резолв по `X-Tenant-Slug` через cache+repo. */
  private async resolveBySlug(slug: string) {
    const cachedSlug = await this.cache.getBySlug(slug)
    const tenant =
      cachedSlug !== null ? await this.tenantRepo.findById(cachedSlug) : await this.tenantRepo.findBySlug(slug)
    if (tenant !== null) {
      await this.cache.setBySlug(slug, tenant.id)
      return TenantContext.forTenant({
        tenantId: tenant.id.value,
        slug: tenant.slug.value,
        chainId: tenant.chainId?.value ?? null,
        isNeutral: tenant.isNeutral,
      })
    }
    // Явно запрошенный slug не найден — НЕ фоллбэкаем на neutral, сигналим 404.
    return TenantContext.forUnresolved('unknown_slug', slug)
  }

  /** Шаг 3 алгоритма: fallback на `slug=neutral` (SRS-API-041 п.3). */
  private async resolveNeutral(host: string | null, slug: string | null) {
    const neutral = await this.tenantRepo.findBySlug(NEUTRAL_SLUG)
    if (neutral !== null) {
      // Нейтральный тенант — настоящая строка в `tenants` с настоящим UUID
      // (`neutral.id.value`). Кладём его в контекст как обычный `tenantId`:
      // `isNeutral: true` уже несёт семантику «это нейтральный пул», прятать
      // его id за `null` не нужно и вредно — потребителям (например,
      // `resolveTenantIdForVerify()` в `otp-verify.controller.ts`) нужен
      // настоящий UUID для записи в колонки `UUID NOT NULL`
      // (`users.tenant_id`, `otp_codes.tenant_id`, `auth_sessions.tenant_id`).
      return TenantContext.forTenant({
        tenantId: neutral.id.value,
        slug: neutral.slug.value,
        chainId: null,
        isNeutral: true,
      })
    }
    // Нет ни Host-совпадения, ни заголовка, ни нейтрального тенанта в БД.
    // Техническая невозможность (seed должен быть), но обработка обязательна.
    this.logger.error({ host, slug }, 'tenant_neutral_tenant_not_found')
    return TenantContext.forUnresolved('technical', NEUTRAL_SLUG)
  }
}

function extractResolutionInputs(req: IncomingMessage): HostAndSlug {
  const rawHost = req.headers.host
  const host = typeof rawHost === 'string' ? stripPort(rawHost).toLowerCase() : null
  const rawSlug = req.headers[TENANT_SLUG_HEADER]
  const slugHeader = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug
  const slug = typeof slugHeader === 'string' && slugHeader.length > 0 ? slugHeader.toLowerCase() : null
  return { host, slug }
}

function stripPort(host: string): string {
  const colonIdx = host.indexOf(':')
  return colonIdx === -1 ? host : host.slice(0, colonIdx)
}
