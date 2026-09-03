/**
 * `postJsonToBank` — тонкая обёртка над `fetch` для HTTP-вызовов `AlifMobiProvider`/
 * `DcNextProvider` (EP-10, DTJ-239). Общий код между двумя адаптерами (`02` C15) — сам
 * контракт запроса/ответа (тело, заголовки) остаётся ASSUMPTION-специфичным для каждого
 * банка и строится вызывающим кодом, эта функция лишь выполняет вызов и разбирает JSON/ошибку.
 *
 * `fetch` — глобальный (Node ≥18, `apps/api` не под фронтовым `no-restricted-globals`-запретом
 * на `fetch`, тот запрет — только `apps/{web,admin,pharmacy,courier}`, `eslint.config.mjs`
 * `dorutj/frontend`). Тестируется через `vi.stubGlobal('fetch', ...)` (встроено в vitest) —
 * `nock` не заводится (правило 6 AGENTS.md: не ставить новых зависимостей).
 */
export interface BankFetchError extends Error {
  readonly httpStatus?: number
}

export async function postJsonToBank<T>(url: string, body: unknown, token: string | undefined): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== undefined) {
    headers.Token = token
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) {
    const error: BankFetchError = Object.assign(new Error(`bank API responded with HTTP ${String(response.status)}`), {
      httpStatus: response.status,
    })
    throw error
  }
  return (await response.json()) as T
}
