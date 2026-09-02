/**
 * `search-history.ts` (DTJ-192, `SRS-CAT-030` п.1).
 *
 * До 5 последних непустых поисковых запросов ЭТОГО браузера — читается/пишется ТОЛЬКО через
 * `localStorage`, без обращения к серверу (SRS-CAT-030: «client-side, без обращения к серверу
 * вообще — быстрее и приватнее»). Используется `use-search-suggestions.ts`, когда ввод пуст:
 * непустая история отображается напрямую, пустая — фолбэк на серверный trending (`search.api.ts`,
 * `q=''`).
 *
 * `localStorage` может бросить исключение (приватный режим/заблокированное хранилище,
 * DTJ-192 «Риски») — каждое обращение обёрнуто `try/catch`, деградация до «истории нет» без
 * падения UI (тот же приём, что `locale-provider.tsx`).
 */

const SEARCH_HISTORY_STORAGE_KEY = 'dorutj:search-history:v1'
const MAX_SEARCH_HISTORY_ITEMS = 5

function parseStoredHistory(raw: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.filter((item): item is string => typeof item === 'string')
}

export function readSearchHistory(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    if (raw === null) {
      return []
    }
    return parseStoredHistory(raw).slice(0, MAX_SEARCH_HISTORY_ITEMS)
  } catch {
    return []
  }
}

function persistSearchHistory(entries: readonly string[]): void {
  try {
    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // best-effort — см. JSDoc файла, персистентность истории не обязана быть надёжной.
  }
}

/**
 * Добавляет `query` в начало истории (дедуп без учёта регистра, лимит `MAX_SEARCH_HISTORY_ITEMS`,
 * старейший вытесняется). Пустой/пробельный `query` — не изменяет историю (SRS-CAT-030 требует
 * только «непустые» запросы).
 */
export function addSearchHistoryEntry(query: string): readonly string[] {
  const trimmed = query.trim()
  const current = readSearchHistory()
  if (trimmed.length === 0) {
    return current
  }
  const withoutDuplicate = current.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase())
  const next = [trimmed, ...withoutDuplicate].slice(0, MAX_SEARCH_HISTORY_ITEMS)
  persistSearchHistory(next)
  return next
}
