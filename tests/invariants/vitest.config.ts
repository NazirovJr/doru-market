/**
 * Vitest config для `tests/invariants` (DTJ-255).
 *
 * ПОЧЕМУ `tests/invariants` — полноценный pnpm-пакет (`package.json`), а НЕ голая папка без
 * него (как `tests/arch`): `escrow-invariant.spec.ts` реально импортирует и исполняет боевой
 * код `apps/api` (домен `Order`, `DrizzleOrderRepository`/`DrizzleEscrowLedgerRepository`,
 * НАСТОЯЩИЙ NestJS+Fastify тест-харнесс вебхука через `@apitest/...`) — это тянет `pg`,
 * `drizzle-orm`, `supertest`, `@dorutj/contracts` как реальные bare-specifier импорты.
 * `tests/arch` обходится БЕЗ package.json ТОЛЬКО потому, что его файлы импортируют исключительно
 * то, что УЖЕ хоистится в корневой `node_modules` как devDependency корня (`vitest`,
 * `dependency-cruiser`, `eslint`) — проверено эмпирически (`ls node_modules/pg` и т.д. в корне
 * ничего не находят). Без собственного `package.json`/`node_modules` этот файл не резолвил бы
 * ни `pg`, ни `drizzle-orm`, ни `supertest` — гейт был бы красным на самом первом импорте.
 * Прецедент такого полноценного пакета в этой же `tests/*` группе — `tests/e2e` (`@dorutj/e2e`).
 *
 * ПОЧЕМУ `resolve.alias` (`@` → `apps/api/src`, `@apitest` → `apps/api/test`), а НЕ `../../`
 * относительные импорты: корневой ESLint (`eslint.config.mjs`, `no-restricted-imports`)
 * запрещает импорты через два и более уровня вверх ЛЮБОМУ файлу репозитория, включая этот
 * пакет, и явно предписывает алиас `@/...` как замену. Файлы `apps/api`, переиспользуемые
 * отсюда (`order.entity.ts`, `escrow-ledger.repository.ts`, тест-харнесс вебхука), САМИ пишут
 * `@/...`-импорты — та же подмена делает ИХ собственные внутренние импорты резолвящимися,
 * когда их грузит этот, другой, vitest-процесс.
 *
 * `pool: 'vmThreads'` — тот же обход Windows sandbox EPERM (`child_process.spawn`/`stdio:pipe`
 * под дефолтным `forks`), что и `tests/arch/vitest.config.ts`; см. его JSDoc и
 * `docs/STATE-AND-RESUME-POINT.md` §11.7. Актуально именно здесь: этот сьют, как и `tests/arch`,
 * запускается КОРНЕВЫМ скриптом (`pnpm --filter @dorutj/invariants test`), а не через
 * `apps/api`-собственный `vitest.integration.config.ts` (у него `pool: 'forks'` и работает —
 * но внутри `turbo run test`, другого процесса запуска).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const INTEGRATION_TEST_TIMEOUT_MS = 30_000

/**
 * `@nestjs/config`'s `ConfigModule.forRoot({ validate })` (`apps/api/src/config/config.module.ts`)
 * исполняется на этапе ОПРЕДЕЛЕНИЯ класса `LoggerModule`/`ConfigModule` — то есть при простом
 * ИМПОРТЕ файла (аргументы декоратора `@Module({...})` — обычное выражение JS, вычисляется сразу),
 * а не когда Nest реально строит граф DI. `escrow-invariant.spec.ts` импортирует `createTestApp`
 * (тянет `OrdersModule` → ... → `LoggerModule`/`ConfigModule`) на верхнем уровне файла — это
 * происходит РАНЬШЕ, чем успевает отработать `describe.skipIf`/`beforeAll`/`applyTestEnv()`
 * внутри самого `createTestApp()`. Без обязательных ENV здесь `envSchema.safeParse` (`env.schema.ts`)
 * бросает ДО того, как what-либо в этом файле успевает решить, пропускать сьют или нет — ровно
 * тот же приём, что `apps/api/vitest.integration.config.ts`'s `test.env` уже применяет для
 * `apps/api`-собственных интеграционных спеков. Набор — 1:1 копия `TEST_ENV` из `apps/api/test/
 * integration/payments/__tests__/test-app.ts` (та же НЕ-секретная тестовая RSA-пара, Ж13):
 * `applyTestEnv()` внутри `createTestApp()` использует `??=`, поэтому дубликат здесь не спорит с
 * ним, а просто выигрывает гонку — тот же итоговый набор значений.
 */
const TEST_JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDEARjrYl91iNxF
3YVeQZ430Q7TeFxZ7HN7jqKIEXKvNyU/oTk3Dkd/m1l13uGqpmrtLK/XqH0Gg2mT
brJRBLbaTYv1UKbTUBukaRbGhsz8tWA9T1PL5uqeiPoYQs+HAM6lA1cOciITae85
SH39PbW8r9JneN5yWIfU61QprHmqhmlkespOmYIefhs1Vz8Ml00ykOo7edOMc6JQ
ztZbmdFPtQiO26rYggeoe+U6C0+xv0M/nHOrwrhs5vr1mr4vkjunTZC29TU03pjJ
HEzHG+UVvs2yrmmFfO3Y+1iyuWum6ObiIhn1xUdYf4iTZ21kulVlTdjb2lkQp0Ri
2CihgFW3AgMBAAECggEABTt4RFRYcwVHyA+tT0JWLGxGxotof7gJrys0GIjKtHW2
51dw9RDLBNOLVFOyV4FgylsOiKXFTKa2a0qhtPr4vKQkT9Sq12pEiqOJiZwwnbBj
1M8o0AEmkzvZ3UrvSk3RtmL78HVIhpcl3TQbtOZwUwyog72cxpWpbpwnn4Msrkoj
RqBx6NyhQq9UIpk4iP1fVbSNQO0rwLCSbVX4SG1te6sXKlQm2VEVBMuwo4LPG/w8
+cFKJjUDvYiC/MShGAQfWlhGCqVlhXB+4JX3ioI7wvm3lK/antJ5eGhV5lQO9NyY
619qCj95IxSgrxAR/P240wdyGKVwqwJAh0dQShEPoQKBgQDzpnco0s883mRiqr+1
FMaRUH80ohFeT5AWXPH76ORUPzANrfwbXrLQYWEa1n8HM1p9l6gY/Qyp2yufiZnr
1a90F5847gHoQ78aHQO+WHlDfqK8iGmgcQPH6AYJRr0M4KxKQyyjz0GGV/vKZpk5
WfguQSOEZs82GvSX01/cxLtrVwKBgQDN8GRGWYsveYVe/+T/80rxbXZ2PhxXaEz1
ZSKiWLR6MnTohrBqwJGi2KuEomc+pY7+SSsq+ux/mat6QY0YyVsUdg4hgls95Ob3
TrBHikBCcmJxPkB/O2HpmTCsm8ST5ycPfg86WhfarLQQv8EZeX9horL7QdLT4JC4
e0zBA9xMoQKBgQDF9nrasG2xBwCJKjKY7khnyP+RxBxYhEyN3va9tnvN94kTlElB
869Vn8lGBQEw2IitgosRwoiHeYv4E9T7yKLFsGut1bO3A1RB41EnVrswG7QderhX
o3tu8RX2c4Mm82UI8YtTjRGwFcx+pt3Xu0HqUwKIkP/K9hvFP/ijZzTgAQKBgQCV
Vt8QmPyzB7es5XqGFULigtOl+XKJ/CvaxGVyP0tZVd+rg4jJUS4LXn46555hMqPY
SO0R9PatrZ1JQeH0+Ieg9d9Xc3WBE85dxuVUa7Afv10d69vPqBtfz+QZN7g83SJZ
PLwEP7MOs7C8eKGqPI4gGmEajWg6l526+kb1rTwDIQKBgB+V4z8skw4IXnQ934n/
nblbPu+2y9Y74eCULe+i8RXE9zcG1KOsSs4e7jDm3HKhXlljVT2xZT8YHWxhBP3j
0O//tkV0DVL8VgrLtqnkkOl5sGUwxYTI7fQwh6pC+JMJdm+NoGB3Enue6WPKS/QQ
nyAA7xR2Sj44+PgsgK3GEq8r
-----END PRIVATE KEY-----
`

const TEST_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxAEY62JfdYjcRd2FXkGe
N9EO03hcWexze46iiBFyrzclP6E5Nw5Hf5tZdd7hqqZq7Syv16h9BoNpk26yUQS2
2k2L9VCm01AbpGkWxobM/LVgPU9Ty+bqnoj6GELPhwDOpQNXDnIiE2nvOUh9/T21
vK/SZ3jecliH1OtUKax5qoZpZHrKTpmCHn4bNVc/DJdNMpDqO3nTjHOiUM7WW5nR
T7UIjtuq2IIHqHvlOgtPsb9DP5xzq8K4bOb69Zq+L5I7p02QtvU1NN6YyRxMxxvl
Fb7Nsq5phXzt2PtYsrlrpujm4iIZ9cVHWH+Ik2dtZLpVZU3Y29pZEKdEYtgooYBV
twIDAQAB
-----END PUBLIC KEY-----
`

export default defineConfig({
  resolve: {
    alias: {
      '@apitest': fileURLToPath(new URL('../../apps/api/test', import.meta.url)),
      '@': fileURLToPath(new URL('../../apps/api/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    pool: 'vmThreads',
    // Один spec-файл, без обращения к параллельным файлам той же БД — сериализация файлов
    // (`fileParallelism: false`, см. `apps/api/vitest.integration.config.ts`) здесь не нужна.
    env: {
      NODE_ENV: 'test',
      // `PORT` НЕ задаётся (в отличие от `test-app.ts`'s `TEST_ENV`, где `PORT: '0'`) —
      // найденный дефект СОСЕДНЕГО файла (не в files_owned этого тикета, см. отчёт сдачи
      // DTJ-255, `foundIssues`): `envSchema.PORT` требует `.positive()` (>0), а `'0'`
      // проваливает эту проверку целиком (`0` не строго положительно) ещё до того, как что-либо
      // в этом файле успевает решить, пропускать сьют или нет. `createTestApp()` не вызывает
      // `app.listen()` реальным портом (Supertest общается с Fastify-инстансом напрямую), так
      // что здесь просто не переопределяем `PORT` — действует Zod-дефолт `3000`, валиден.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test',
      // `--requirepass` включён на локальном Redis (`infra/docker/docker-compose.yml`, дефолт
      // `dorutj_dev_redis_password`, дев-дефолт, заведомо непроизводственный, коммитить можно) —
      // `test-app.ts`'s TEST_ENV использует `redis://localhost:6379/0` БЕЗ пароля, что здесь
      // даёт `NOAUTH Authentication required` на каждой команде `MockBankProvider`'s BullMQ
      // `Queue` (см. `apps/api/vitest.integration.config.ts`, тот же приём для пароля).
      REDIS_URL: process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/0',
      REQUEST_TIMEOUT_MS: '30000',
      CORS_STATIC_ORIGINS: 'http://localhost:3000',
      MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
      OTP_REQUEST_COOLDOWN_SECONDS: '60',
      OTP_REQUEST_MAX_PER_10MIN: '3',
      OTP_REQUEST_MAX_PER_DAY: '10',
      OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
      OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_invariants',
      OTP_VERIFY_MAX_ATTEMPTS: '5',
      TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-invariants',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      LOG_LEVEL: 'error',
      JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
      JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
      JWT_KID: 'test-v1-invariants',
      CART_HOLD_TTL_SECONDS: '900',
      PAYMENT_DRIVER: 'mock_bank',
      // ДОЛЖЕН совпадать с `TEST_MOCK_BANK_WEBHOOK_SECRET`, экспортируемым `apps/api/test/
      // integration/payments/__tests__/test-app.ts` — escrow-invariant.spec.ts подписывает
      // вебхук ИМЕННО этой константой; `applyTestEnv()` внутри `createTestApp()` использует
      // `??=` и не перезапишет уже выставленное здесь значение, так что расхождение дало бы
      // 401 INVALID_WEBHOOK_SIGNATURE на каждом вебхуке.
      MOCK_BANK_WEBHOOK_SECRET: 'test-mock-bank-webhook-secret-dtj242',
      MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
    },
  },
})
