/**
 * Тип-обёртка `Result<T, E>` для случаев, когда ошибка — это ожидаемый результат операции
 * (валидация пользовательского ввода, парсинг VO), а не исключение. Исключения остаются
 * для программных ошибок вызывающего кода (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.5).
 *
 * Локальное определение для `packages/domain-kernel`, чтобы пакет не зависел от
 * `packages/contracts` (который может в будущем нести другие абстракции). Если в EP-01
 * появится идентичный тип — миграция на единый источник, типовой контракт совместим.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
  return !result.ok
}
