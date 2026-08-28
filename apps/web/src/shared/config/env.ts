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
  if (typeof value !== 'string' || value.length === 0) {
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
