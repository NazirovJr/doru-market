/**
 * Клиентский аналог `env.schema.ts` backend-тикетов: единственное место, где `apps/web` читает
 * `import.meta.env.*`. Валидирует обязательные переменные при первом обращении и бросает понятную
 * ошибку вместо того, чтобы `http-client` тихо слал запросы на `"undefined"` (DTJ-003, критерий
 * приёмки 3). Сборочная (`vite build`/`vite dev`) проверка того же требования — в `vite.config.ts`.
 */

interface ClientEnv {
  readonly apiBaseUrl: string
}

function readApiBaseUrl(): string {
  const value: string | undefined = import.meta.env.VITE_API_BASE_URL
  // Пустая строка допустима и означает «API на том же origin»: `http-client` склеивает базу с
  // путём (`${base}${path}`), поэтому пустая база даёт относительный `/api/v1/...`, который в
  // compose-стенде проксирует nginx. Ошибка по-прежнему бросается на ОТСУТСТВУЮЩЕЙ переменной —
  // именно она приводила к запросам на "undefined", ради чего проверка и заводилась.
  if (typeof value !== 'string') {
    throw new Error(
      'VITE_API_BASE_URL не задан. Скопируй apps/web/.env.example в apps/web/.env и заполни значение ' +
        'перед запуском dev-сервера или сборки.',
    )
  }
  return value
}

let cachedEnv: ClientEnv | undefined

/** Ленивая валидация: значение читается один раз и кешируется на время жизни модуля. */
export function getClientEnv(): ClientEnv {
  cachedEnv ??= { apiBaseUrl: readApiBaseUrl() }
  return cachedEnv
}
