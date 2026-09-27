/**
 * `waitForReady` (DTJ-417, тест-план п.3) — локальная защита на случай, если Playwright
 * запускается БЕЗ предварительного `wait-on`/`curl`-опроса из CI `job: e2e` (DTJ-414) —
 * например, разработчик поднял стек вручную и тут же запустил `pnpm test:e2e`, не дожидаясь
 * healthcheck'а `docker compose`. Используется в `globalSetup` (`playwright.config.ts`).
 *
 * Не заменяет `SRS-NFR-030` (детерминированность) — просто откладывает старт тестов до
 * готовности зависимостей, ретраи здесь про ВРЕМЯ старта инфраструктуры, а не про флакиность
 * самих сценариев.
 */

export interface WaitForReadyOptions {
  /** Полный URL readiness-эндпоинта (обычно `${baseURL}/ready`). */
  readonly url: string
  /** Максимальное время ожидания, мс. */
  readonly timeoutMs?: number
  /** Пауза между попытками, мс. */
  readonly intervalMs?: number
  /** Подмена `fetch` — только для юнит-теста этого хелпера. */
  readonly fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_INTERVAL_MS = 1_000

/**
 * Опрашивает `options.url`, пока он не ответит `200`, либо не истечёт `timeoutMs` — тогда
 * бросает понятную ошибку (не виснет бесконечно, критерий приёмки тест-плана DTJ-417).
 */
export async function waitForReady(options: WaitForReadyOptions): Promise<void> {
  const { url, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS, fetchImpl = fetch } = options
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const ok = await probeOnce(url, fetchImpl)
    if (ok) return
    if (Date.now() >= deadline) {
      throw new Error(`waitForReady: ${url} не ответил 200 за ${String(timeoutMs)}мс`)
    }
    await sleep(intervalMs)
  }
}

async function probeOnce(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url)
    return response.status === 200
  } catch {
    // Сеть/сервис ещё не поднялись — это ожидаемое промежуточное состояние, не ошибка.
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
