/**
 * Vitest config для `tests/security` (DTJ-425) — 1:1 приём `tests/invariants/vitest.config.ts`
 * (DTJ-255): этот пакет тоже реально импортирует и исполняет боевой код `apps/api`
 * (`createApp()`, реальные Nest-модули) против настоящего Postgres/Redis, не мока — см. её
 * подробный JSDoc для обоснования `package.json`/алиасов/`pool: 'vmThreads'`, не повторяемое
 * здесь дословно.
 *
 * `fileParallelism: false` — файлы этого пакета делят один `dorutj_test` (те же
 * таблицы/тенанты, что `tests/invariants`) — параллельный запуск дал бы гонки между спеками
 * (напр. `rate-limiting.spec.ts` создаёт свой `NestFastifyApplication` с временным
 * `RATE_LIMIT_ANON_PER_MIN`, установленным ДО динамического импорта `@/main.js`; другой файл,
 * запущенный параллельно в том же процессе, унаследовал бы это значение).
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const SECURITY_TEST_TIMEOUT_MS = 60_000

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
    testTimeout: SECURITY_TEST_TIMEOUT_MS,
    hookTimeout: SECURITY_TEST_TIMEOUT_MS,
    pool: 'vmThreads',
    fileParallelism: false,
    // `rate-limiting.spec.ts` runs через ОТДЕЛЬНЫЙ npm-скрипт (`test:rate-limit`, см.
    // `package.json`) — живым прогоном обнаружено (DTJ-425, не выдумано заранее): когда оно
    // выполняется В ОДНОМ vitest-воркере ПОСЛЕ другого файла, уже импортировавшего
    // `@/config/...` транзитивно (`tenant-isolation-idor.spec.ts` → `createTestApp()`),
    // `RATE_LIMIT_ANON_PER_MIN`, установленный этим файлом ПРЯМЫМ присваиванием ДО своего
    // `import('@/main.js')`, не подхватывается — 101-й запрос получает `200`, а не `429`
    // (изолированный прогон ТОГО ЖЕ файла — зелёный). Похоже на утечку состояния между файлами
    // через `pool: 'vmThreads'` (несмотря на `isolate` по умолчанию `true`) — не расследовано
    // до конца (вне бюджета тикета; не блокер: воспроизводимый обходной путь есть). Исключение
    // здесь гарантирует полностью отдельный процесс, а не полагается на изоляцию пула.
    // `log-pii-leakage.spec.ts` — та же утечка состояния через `pool: 'vmThreads'`, что
    // `rate-limiting.spec.ts` (см. комментарий выше): `LOG_LEVEL='info'`, установленный ПРЯМЫМ
    // присваиванием ДО `import('@/main.js')`, не подхватывается, когда файл выполняется В ОДНОМ
    // воркере ПОСЛЕ `tenant-isolation-idor.spec.ts` (тоже транзитивно импортирует `@/config/...`)
    // — живым прогоном подтверждено (изолированный прогон того же файла зелёный). Свой npm-
    // скрипт (`test:log-pii`), тот же приём, что `test:rate-limit`.
    exclude: ['**/node_modules/**', 'rate-limiting.spec.ts', 'log-pii-leakage.spec.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/0',
      REQUEST_TIMEOUT_MS: '30000',
      CORS_STATIC_ORIGINS: 'http://localhost:3000',
      MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
      OTP_REQUEST_COOLDOWN_SECONDS: '60',
      OTP_REQUEST_MAX_PER_10MIN: '3',
      OTP_REQUEST_MAX_PER_DAY: '10',
      OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
      OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_security',
      OTP_VERIFY_MAX_ATTEMPTS: '5',
      TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-security',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      LOG_LEVEL: 'error',
      JWT_PRIVATE_KEY: TEST_JWT_PRIVATE_KEY,
      JWT_PUBLIC_KEY: TEST_JWT_PUBLIC_KEY,
      JWT_KID: 'test-v1-security',
      CART_HOLD_TTL_SECONDS: '900',
      PAYMENT_DRIVER: 'mock_bank',
      MOCK_BANK_WEBHOOK_SECRET: 'test-mock-bank-webhook-secret-dtj425',
      MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
      // Щедрый дефолт — большинство файлов этого пакета не тестируют rate-limit сами и не
      // должны случайно словить 429 от глобального плагина при десятках запросов в одном
      // тесте (напр. `sql-injection.spec.ts` — 6 пейлоадов + before/after подсчёт).
      // `rate-limiting.spec.ts` переопределяет ОБА значения напрямую (без `??=`) перед своим
      // собственным динамическим `import('@/main.js')`.
      RATE_LIMIT_ANON_PER_MIN: '1000',
      RATE_LIMIT_USER_PER_MIN: '1000',
      RATE_LIMIT_1C_BATCH_PER_MIN: '1000',
    },
  },
})
