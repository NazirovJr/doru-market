/**
 * `TenantContext` (DTJ-054) — обёртка над `AsyncLocalStorage`, переживающая
 * весь жизненный цикл одного HTTP-запроса (аналогично `RequestContext`).
 *
 * Семантика:
 *   - `current()` возвращает `undefined` ВНЕ активного запроса (например,
 *     при фоновой job или в тестах без `run`). Это позволяет вызывающему
 *     коду отличить «контекст ещё не инициализирован» от «тенант явно null».
 *   - `run()` устанавливает снимок контекста на время `callback`. Используется
 *     `TenantResolutionMiddleware` (Fastify-middleware) и
 *     `TelegramWebhookController` (DTJ-062, ручной резолв).
 *   - `update()` — точечное изменение полей (после резолвинга в шаге 2/3).
 *
 * `tenantId === null` означает «тенант РЕЗОЛВЛЕН как нейтральный» (НЕ
 * «резолвинг не выполнялся» — для нерезолвленных случаев используется
 * `unresolved: true`). Это различие важно для guard'а DTJ-055.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TenantContextStore {
  readonly tenantId: string | null
  readonly slug: string
  readonly chainId: string | null
  readonly isNeutral: boolean
  /** `true` если резолвинг завершился с ошибкой (различение `unknown_slug`/`technical`). */
  unresolved: boolean
  /** Тип ошибки резолвинга, если `unresolved: true`. */
  unresolvedReason: 'unknown_slug' | 'technical' | null
}

const storage = new AsyncLocalStorage<TenantContextStore>()

export const TenantContext = {
  run<T>(store: TenantContextStore, callback: () => T): T {
    return storage.run(store, callback)
  },

  get(): TenantContextStore | undefined {
    return storage.getStore()
  },

  update(patch: Partial<Omit<TenantContextStore, 'tenantId' | 'slug' | 'chainId' | 'isNeutral'>>): void {
    const store = storage.getStore()
    if (store === undefined) {
      return
    }
    Object.assign(store, patch)
  },

  /**
   * Создаёт «успешно резолвленный» снимок для найденного тенанта.
   * Вызывающий передаёт результат `TenantRepository.findBy*` (или `null` для
   * нейтрального фолбэка).
   */
  forTenant(args: {
    tenantId: string | null
    slug: string
    chainId: string | null
    isNeutral: boolean
  }): TenantContextStore {
    return {
      tenantId: args.tenantId,
      slug: args.slug,
      chainId: args.chainId,
      isNeutral: args.isNeutral,
      unresolved: false,
      unresolvedReason: null,
    }
  },

  /** Снимок для `unresolved = true` случая. */
  forUnresolved(reason: 'unknown_slug' | 'technical', slugHint: string): TenantContextStore {
    return {
      tenantId: null,
      slug: slugHint,
      chainId: null,
      isNeutral: false,
      unresolved: true,
      unresolvedReason: reason,
    }
  },
}
