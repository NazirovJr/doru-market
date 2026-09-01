/**
 * DI-токен общего Redis-клиента (инфраструктура EP-02, DTJ-053).
 *
 * `apps/worker` и другие модули могут переиспользовать тот же токен, не создавая
 * параллельных пулов. `RedisHealthIndicator` (DTJ-001) использует ОТДЕЛЬНЫЙ
 * клиент — не вмешиваемся в его существование.
 */
export const REDIS_CLIENT = Symbol.for('@dorutj/api/redis-client')
