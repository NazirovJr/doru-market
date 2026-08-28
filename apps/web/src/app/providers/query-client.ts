import { QueryClient } from '@tanstack/react-query'

const DEFAULT_QUERY_RETRY_COUNT = 1

/**
 * Единая точка конфигурации TanStack Query (DTJ-003, шаг 2: `defaultOptions.queries.retry`
 * конфигурируемо) — фичи не переопределяют retry-политику по месту использования.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: DEFAULT_QUERY_RETRY_COUNT,
    },
  },
})
